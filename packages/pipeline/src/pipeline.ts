import type { Profile } from "@rulekitai/agent/profile"
import type { Turn } from "@rulekitai/agent/turn"
import type { RuleStore } from "@rulekitai/corpus/store"
import { MemoryCache } from "./cache.ts"
import type { Answer, AskContext, Cache, Stage } from "./types.ts"

export type PipelineOptions = {
  store: RuleStore
  profile: Profile
  stages: Stage[]
  cache?: Cache
}

export type RunInput = {
  question: string
  history?: Turn[]
  caller?: AskContext["caller"]
  signal?: AbortSignal
}

/** What a whole run produced, including the stages that failed on the way. */
export type RunResult = {
  answer: Answer | null
  degraded: string[]
  /** Every stage that ran, in order, and what it did. For a status page. */
  trace: { stage: string; outcome: "answered" | "passed" | "skipped" | "failed"; ms: number }[]
}

/**
 * The answer pipeline.
 *
 * Stages run in order and the first one that can answer wins. Every stage before
 * the last is an optimisation, so a stage that fails must degrade to a miss and
 * let the run continue. It must never take the answer down with it.
 *
 * A failure is REPORTED, not swallowed. A stage that quietly returns null when
 * it is actually broken looks exactly like a stage that had nothing to say, and
 * the difference is the whole diagnosis: one is healthy, and the other has been
 * sending every question to the most expensive layer for weeks.
 */
export function createPipeline(options: PipelineOptions) {
  const cache = options.cache ?? new MemoryCache()

  async function run(input: RunInput): Promise<RunResult> {
    const startedAt = Date.now()
    const history = input.history ?? []
    const ctx: AskContext = {
      question: input.question,
      history,
      isFollowUp: history.length > 0,
      store: options.store,
      profile: options.profile,
      cache,
      retrieved: [],
      caller: input.caller,
      signal: input.signal,
    }

    const degraded: string[] = []
    const trace: RunResult["trace"] = []

    for (const stage of options.stages) {
      if (stage.when && !stage.when(ctx)) {
        trace.push({ stage: stage.name, outcome: "skipped", ms: 0 })
        continue
      }
      const stageStarted = Date.now()
      let answer: Answer | null = null
      try {
        answer = await stage.run(ctx)
      } catch (err) {
        console.error(`[rulekit] stage "${stage.name}" failed, continuing:`, err)
        degraded.push(stage.name)
        trace.push({ stage: stage.name, outcome: "failed", ms: Date.now() - stageStarted })
        continue
      }
      const ms = Date.now() - stageStarted
      if (!answer) {
        trace.push({ stage: stage.name, outcome: "passed", ms })
        continue
      }
      trace.push({ stage: stage.name, outcome: "answered", ms })
      return {
        answer: {
          ...answer,
          // The pipeline owns the latency a reader actually waited, which is the
          // whole run and not one stage's share of it.
          latencyMs: Date.now() - startedAt,
          ...(degraded.length ? { degraded: [...degraded] } : {}),
        },
        degraded,
        trace,
      }
    }

    return { answer: null, degraded, trace }
  }

  /**
   * The context one request would build, without running anything.
   *
   * A gate runs BEFORE the pipeline, so a refusal costs nothing. It still needs
   * the same context a stage would see, and building that here is what stops a
   * caller assembling a half-filled copy of its own.
   */
  function contextFor(input: RunInput): AskContext {
    const history = input.history ?? []
    return {
      question: input.question,
      history,
      isFollowUp: history.length > 0,
      store: options.store,
      profile: options.profile,
      cache,
      retrieved: [],
      caller: input.caller,
      signal: input.signal,
    }
  }

  return { run, contextFor, cache, stages: options.stages, store: options.store, profile: options.profile }
}

export type Pipeline = ReturnType<typeof createPipeline>
