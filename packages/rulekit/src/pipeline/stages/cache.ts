import { answerKey, DEFAULT_TTL_SECONDS } from "../cache.ts"
import type { Answer, AskContext, Stage } from "../types.ts"

/** The part of an answer worth keeping. Request-scoped fields are not cached. */
type CachedAnswer = { text: string; citations: Record<string, unknown>[]; source: string }

export type CacheStageOptions = {
  /**
   * Scopes every key. Change it when the corpus changes, and every stale answer
   * becomes unreachable at once with no keys to enumerate and delete.
   */
  version?: string
  ttlSeconds?: number
}

/**
 * A verbatim repeat of a question already answered.
 *
 * Free and instant. This is the first stage for the obvious reason: whatever the
 * next stage would cost, it costs nothing here.
 *
 * FIRST TURN ONLY. A follow-up depends on the conversation before it, so the
 * same words mean different things to two readers. Caching "shorter" would serve
 * one reader's shortened answer to the next reader who typed the same word about
 * something else entirely.
 */
export function exactCacheStage(options: CacheStageOptions = {}): Stage {
  const version = options.version ?? "1"
  return {
    name: "cache",
    when: (ctx: AskContext) => !ctx.isFollowUp,
    async run(ctx: AskContext): Promise<Answer | null> {
      const cached = await ctx.cache.get<CachedAnswer>(answerKey(ctx.question, version))
      if (!cached?.text) return null
      return {
        text: cached.text,
        citations: cached.citations ?? [],
        source: cached.source ?? "cache",
        servedBy: "cache",
        latencyMs: 0,
        model: null,
      }
    },
  }
}

/**
 * Write a completed answer back to the cache.
 *
 * This is not a stage. Call it after a run, with what the run produced.
 *
 * Two things are never written. A follow-up, for the reason above. And an
 * INCOMPLETE answer: text cut off mid-sentence is worth showing to the reader
 * who waited for it, and would be served to everybody who asks the same question
 * for as long as the entry lives.
 */
export async function writeBack(
  ctx: AskContext,
  answer: Answer,
  options: CacheStageOptions = {},
): Promise<void> {
  if (ctx.isFollowUp) return
  if (answer.complete === false) return
  if (!answer.text.trim()) return
  if (answer.servedBy === "cache") return
  try {
    await ctx.cache.set<CachedAnswer>(
      answerKey(ctx.question, options.version ?? "1"),
      { text: answer.text, citations: answer.citations, source: answer.source },
      options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    )
  } catch (err) {
    // The answer is already whole and already delivered. Losing its cache copy
    // costs the next asker a repeat, and throwing here would cost this asker the
    // answer they already have.
    console.error("[rulekit] cache write-back failed:", err)
  }
}
