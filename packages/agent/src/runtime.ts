import type { RuleStore } from "@rulekit/corpus/store"
import { type AgentEvent, deriveLabel, encodeEvent, type TraceStep } from "./events.ts"
import { buildInstructions } from "./instructions.ts"
import type { Profile } from "./profile.ts"
import { builtinSkills, type Skill } from "./skills.ts"
import { defineRulesTools, type RuleTool } from "./tools.ts"
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
   * `@rulekit/agent/turn` for why this project sets none: a cap is a cost
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
      "@rulekit/agent/runtime needs the `ai` package, which is a peer dependency. " +
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
  const tools = [...defineRulesTools(options.store, options.profile), ...(options.extraTools ?? [])]
  // The card procedure is only useful where card tools exist. Including it for a
  // corpus with no cards would teach the model to call tools it does not have.
  const skills =
    options.skills ??
    builtinSkills().filter((skill) => skill.name !== "card_lookup" || options.profile.cards.enabled)
  const instructions = options.instructions ?? buildInstructions(options.profile, { skills })
  const cap = options.stepCap ?? null

  async function* stream(input: AskInput): AsyncGenerator<AgentEvent> {
    const startedAt = Date.now()
    const { streamText, tool } = await loadAiSdk()

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

    if (done) return done
    // The stream always ends with a done event, so reaching here means it was
    // interrupted. Report what there is rather than an empty success.
    throw new Error(error ?? "the agent stream ended without an answer")
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

  return { stream, ask, toNdjsonStream, tools, instructions }
}

export type RulesAgent = ReturnType<typeof createRulesAgent>
