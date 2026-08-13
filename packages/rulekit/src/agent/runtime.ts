import type { RuleStore } from "../corpus/store.ts"
import { type AgentEvent, deriveLabel, encodeEvent, type TraceStep } from "./events.ts"
import { buildInstructions } from "./instructions.ts"
import type { Profile } from "./profile.ts"
import { defineReferenceTools, type ReferenceOptions } from "./references.ts"
import { builtinSkills, type Skill } from "./skills.ts"
import { assertUniqueToolNames, corpusContents, defineRulesTools, type RuleTool } from "./tools.ts"
import {
  addStepUsage,
  buildMessage,
  EMPTY_USAGE,
  type RetrievedRule,
  salvageAnswer,
  stepCapReached,
  stopAtStepCap,
  type Turn,
  type UsageTotals,
  usageOrNull,
} from "./turn.ts"

/**
 * The agent, running on the AI SDK.
 *
 * This is the default runtime. It needs one model credential and nothing else:
 * no agent framework, no separate process, no deployment of its own. The Eve
 * template in `templates/` is the alternative, and both emit the same events, so
 * the interface cannot tell them apart.
 *
 * The AI SDK is a peer dependency. Import this module only if you use it.
 */

export type AskInput = {
  question: string
  history?: Turn[]
  /** Rules an earlier stage already found, so the agent need not search again. */
  rules?: RetrievedRule[]
}

export type RulesAgentOptions = {
  store: RuleStore
  profile: Profile
  /**
   * The model, as a plain "provider/model" string or an AI SDK model object.
   *
   * A string routes through the AI SDK's gateway, which is what lets a fork
   * change provider by changing one environment variable. Nothing in this
   * project requires a particular provider.
   */
  model: string | LanguageModelLike
  /**
   * Provider-specific settings, passed to the AI SDK untouched.
   *
   * There is no portable way to ask for a reasoning effort, a thinking budget,
   * or a safety setting: every provider spells them differently and respells
   * them between model versions. So this project does not invent a name for
   * them and translate. It hands yours through and takes no position.
   *
   * An earlier version did try, mapping a `reasoning: "low"` option onto one
   * provider's thinking field. It was wrong within a model generation, and
   * every request failed with a message about a field this project chose.
   *
   *     providerOptions: { anthropic: { thinking: { type: "adaptive" } } }
   *
   * Read your provider's AI SDK page for the shape it wants.
   */
  providerOptions?: Record<string, Record<string, unknown>>
  /**
   * A ceiling on the model calls one turn may make.
   *
   * **Unset by default, which means no ceiling.** A turn ends when the model
   * stops calling tools and writes its answer. See `NO_STEP_CAP` in
   * `@rulekitai/rulekit/agent/turn` for why this project sets none: a cap is a cost
   * control, and cost is the fork's decision, not this project's.
   *
   * Set it when you pay per token. A capped turn hands the reader whatever was
   * written when the ceiling hit, which can be half a sentence.
   */
  stepCap?: number | null
  /** Instructions override. Defaults to buildInstructions(profile) plus the skills. */
  instructions?: string
  /** Extra tools, merged with the corpus tools. */
  extraTools?: RuleTool[]
  /**
   * Sites outside the corpus that this agent may read when the corpus misses.
   *
   * **Off unless you set it, and rulekit ships no sites.** Setting it grants
   * this agent outbound network access, so it is an option on the runtime rather
   * than a field in a corpus: copying a corpus must never grant a server a
   * capability it did not ask for.
   *
   * Pass the sites here rather than building the tools yourself and passing them
   * through `extraTools`. This option also adds the instruction block that makes
   * the model label an outside claim as one, and the tools without that block
   * produce answers that cite somebody's website as though it were the rules.
   *
   * You are responsible for each site's terms of use.
   */
  references?: ReferenceOptions
  /**
   * Procedures to inline. Defaults to the skills that ship with this package,
   * filtered to the ones this profile can use.
   */
  skills?: Skill[]
}

/** The shape of an AI SDK model object, without importing the type. */
type LanguageModelLike = { readonly modelId: string }

/** What one completed turn produced. */
export type AgentAnswer = {
  text: string
  complete: boolean
  steps: TraceStep[]
  usage: UsageTotals | null
  model: string | null
  latencyMs: number
}

type StreamTextFn = (options: Record<string, unknown>) => {
  fullStream: AsyncIterable<Record<string, unknown>>
}

/**
 * The answer a finished turn produced, or the reason there is none.
 *
 * A turn that failed before writing a word is a failure, not an empty answer.
 * The stream reports the error and STILL ends with a terminal event, because
 * that event is the only one carrying what the failed steps cost. Returning it
 * would turn a provider outage into a silent blank, and a caller grading
 * answers would score the blank as clean: it cites nothing and quotes nothing,
 * so every check on the content passes.
 *
 * Partial text survives. A model that wrote something and then failed returns
 * what it wrote, marked incomplete, because that is worth more than nothing.
 */
export function resolveAnswer(done: AgentAnswer | null, error: string | null): AgentAnswer {
  if (done && (done.text || !error)) return done
  throw new Error(error ?? "the agent stream ended without an answer")
}

/** Load the AI SDK lazily, with an error a reader can act on. */
async function loadAiSdk(): Promise<{ streamText: StreamTextFn; tool: (spec: unknown) => unknown }> {
  try {
    const mod = (await import("ai")) as unknown as {
      streamText: StreamTextFn
      tool: (spec: unknown) => unknown
    }
    return mod
  } catch (err) {
    throw new Error(
      "@rulekitai/rulekit/agent/runtime needs the `ai` package, which is a peer dependency. " +
        `Install it with \`pnpm add ai\`, or use the Eve template instead. (${String(err)})`,
    )
  }
}

const modelId = (model: string | LanguageModelLike): string =>
  typeof model === "string" ? model : model.modelId

/**
 * Build the agent for one corpus.
 *
 * The returned object exposes two shapes of the same turn. `stream` yields
 * events as they happen, and `ask` waits for the whole answer. `ask` is written
 * in terms of `stream` on purpose: two implementations of one loop is how a
 * streaming path and a non-streaming path come to disagree about what an answer
 * is.
 */
export function createRulesAgent(options: RulesAgentOptions) {
  // Built on the first turn, not here, because knowing which collections hold
  // anything needs a read and this function is not async. The answer cannot
  // change while a process runs: a corpus is a file, opened read-only.
  //
  // The tools and the instructions are built together because they answer to
  // the same read. A procedure that names a tool the corpus cannot offer teaches
  // the model to call something that is not there, so the two must never be
  // decided from different information.
  let setupPromise: Promise<{ tools: RuleTool[]; instructions: string }> | null = null
  const setup = (): Promise<{ tools: RuleTool[]; instructions: string }> => {
    setupPromise ??= corpusContents(options.store).then((contents) => {
      const tools = [
        ...defineRulesTools(options.store, options.profile, contents),
        ...(options.extraTools ?? []),
      ]
      // A procedure is useful only where its tools exist. A procedure that names
      // a tool the corpus cannot offer teaches the model to call something that
      // is not there.
      //
      // The reference tools are built again for each turn, because their fetch
      // count lives in a closure. Their NAMES do not change, so building one set
      // here and discarding it is enough to decide which procedures apply.
      const referenceNames = options.references
        ? defineReferenceTools(options.references).map((t) => t.name)
        : []
      const names = new Set([...tools.map((t) => t.name), ...referenceNames])
      // This filter also covers a caller's own procedures, which the old
      // hard-coded list could not reach.
      const skills = (options.skills ?? builtinSkills()).filter(
        (skill) => !skill.requiresTool || names.has(skill.requiresTool),
      )
      const instructions =
        options.instructions ??
        buildInstructions(options.profile, { skills, references: Boolean(options.references?.sites.length) })
      return { tools, instructions }
    })
    return setupPromise
  }
  const cap = options.stepCap ?? null

  async function* stream(input: AskInput): AsyncGenerator<AgentEvent> {
    const startedAt = Date.now()
    const { streamText, tool } = await loadAiSdk()
    const { tools: corpusTools, instructions } = await setup()
    // Built per turn, because the fetch cap lives in their closure. Reusing one
    // set would spend the whole budget on the first question and refuse every
    // question after it for the life of the process.
    const tools = [...corpusTools, ...(options.references ? defineReferenceTools(options.references) : [])]
    // Before the map below, because `Object.fromEntries` keeps the LAST entry
    // for a repeated name and reports nothing.
    assertUniqueToolNames(tools)
    const describers = new Map(
      tools
        .filter((t) => t.describeResult)
        .map((t) => [t.name, t.describeResult as NonNullable<typeof t.describeResult>]),
    )

    const toolMap = Object.fromEntries(
      tools.map((t) => [
        t.name,
        tool({ description: t.description, inputSchema: t.inputSchema, execute: t.execute }),
      ]),
    )

    const steps = new Map<string, TraceStep>()
    let usage: UsageTotals = EMPTY_USAGE
    let running = ""
    let finalText = ""
    let capped: { text: string; complete: boolean } | null = null

    try {
      const result = streamText({
        model: options.model,
        system: instructions,
        prompt: buildMessage(input.question, input.history ?? [], input.rules ?? []),
        tools: toolMap,
        // The AI SDK stops after ONE step unless told otherwise, so a tool
        // loop needs this even when nothing is being capped. Returning false
        // never stops the loop early; the turn still ends by itself the moment
        // the model answers without calling a tool.
        stopWhen:
          cap === null ? () => false : ({ steps: taken }: { steps: unknown[] }) => taken.length >= cap,
        // Passed through exactly as given. Nothing here inspects or translates
        // it, so this project cannot be wrong about a provider's spelling.
        ...(options.providerOptions ? { providerOptions: options.providerOptions } : {}),
      })

      for await (const part of result.fullStream) {
        const type = part.type as string

        if (type === "tool-call") {
          const id = String(part.toolCallId ?? "")
          const name = String(part.toolName ?? "")
          const { label, kind } = deriveLabel(name, part.input as Record<string, unknown> | undefined)
          const step: TraceStep = { id, tool: name, label, kind, status: "running" }
          steps.set(id, step)
          yield { type: "step", step }
          continue
        }

        if (type === "tool-result" || type === "tool-error") {
          const id = String(part.toolCallId ?? "")
          const step = steps.get(id)
          if (step) {
            step.status = type === "tool-result" ? "completed" : "failed"
            if (type === "tool-result") {
              // The AI SDK has spelled this field two ways across its major
              // versions, and this package supports three of them. Reading both
              // costs nothing; reading one loses the marker silently on the
              // versions that use the other, which is the failure a reader
              // cannot see.
              const output = part.output ?? part.result
              const extra = describers.get(step.tool)?.(output)
              if (extra) Object.assign(step, extra)
            }
            yield { type: "step", step: { ...step } }
          }
          continue
        }

        if (type === "text-delta") {
          running += String(part.text ?? "")
          yield { type: "text", text: running }
          continue
        }

        if (type === "finish-step") {
          // The WHOLE step, not just its usage: the price arrives on the
          // provider metadata, beside the token counts and not among them.
          usage = addStepUsage(usage, part.usage as never, part.providerMetadata as never)
          // The model may still be mid-answer. Stopping here keeps whatever it
          // wrote and marks the answer incomplete, so nothing caches a
          // half-sentence.
          if (cap !== null && stepCapReached(usage, cap)) {
            capped = stopAtStepCap(finalText, running, usage.agent_steps ?? 0, cap)
            break
          }
          continue
        }

        if (type === "finish") {
          finalText = running
          continue
        }

        if (type === "error") {
          const message = part.error instanceof Error ? part.error.message : String(part.error)
          yield { type: "error", error: message }
          // Break rather than return. Every step before the failure was still
          // paid for, and the done event below is the only one carrying usage.
          break
        }
      }
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) }
    }

    const { text, complete } = capped ?? salvageAnswer(finalText, running)
    yield {
      type: "done",
      text,
      source: "agent",
      complete,
      usage: usageOrNull(usage),
      model: modelId(options.model),
      latencyMs: Date.now() - startedAt,
    }
  }

  async function ask(input: AskInput): Promise<AgentAnswer> {
    const steps: TraceStep[] = []
    let text = ""
    let error: string | null = null
    let done: AgentAnswer | null = null

    for await (const event of stream(input)) {
      if (event.type === "step") {
        const index = steps.findIndex((s) => s.id === event.step.id)
        if (index === -1) steps.push(event.step)
        else steps[index] = event.step
      } else if (event.type === "text") {
        text = event.text
      } else if (event.type === "error") {
        error = event.error
      } else {
        done = {
          // Fall back to the streamed text. A terminal event that carries none
          // still ends a turn that produced real output, and taking its empty
          // string would throw away an answer the model already wrote.
          text: event.text || text,
          complete: event.complete,
          steps,
          usage: (event.usage as UsageTotals | null) ?? null,
          model: event.model ?? null,
          latencyMs: event.latencyMs ?? 0,
        }
      }
    }

    return resolveAnswer(done, error)
  }

  /** The same turn as an NDJSON byte stream, ready to return from a route. */
  function toNdjsonStream(input: AskInput): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder()
    const iterator = stream(input)
    return new ReadableStream({
      async pull(controller) {
        const { done, value } = await iterator.next()
        if (done) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(encodeEvent(value)))
      },
      cancel() {
        void iterator.return?.(undefined)
      },
    })
  }

  /**
   * Every tool one turn would be given, for anybody inspecting the agent.
   *
   * Async, and `instructions` is too, because both now depend on reading which
   * collections the corpus holds. A tool for an empty collection and a procedure
   * naming a tool that does not exist are the same failure, so neither can be
   * decided before that read happens.
   */
  const tools = async (): Promise<RuleTool[]> => {
    const { tools: corpusTools } = await setup()
    const all = [...corpusTools, ...(options.references ? defineReferenceTools(options.references) : [])]
    // The same guard the turn applies, so a caller who inspects the agent meets
    // the fault here rather than on the first question.
    assertUniqueToolNames(all)
    return all
  }
  const instructions = async (): Promise<string> => (await setup()).instructions

  return { stream, ask, toNdjsonStream, tools, instructions }
}

export type RulesAgent = ReturnType<typeof createRulesAgent>
