import { answerKey, DEFAULT_TTL_SECONDS } from "../cache.ts"
import type { Answer, AskContext, Stage } from "../types.ts"

/** The part of an answer worth keeping. Request-scoped fields are not cached. */
type CachedAnswer = { text: string; citations: Record<string, unknown>[]; source: string }

/**
 * What `writeBack` may be told.
 *
 * The cache VERSION is deliberately absent. It lives on the request, set once by
 * `createPipeline`, because the reading stage and the three writers must all use
 * the same number: a version set on one of them alone is read at the new number
 * and written at the old one, which empties the cache for good instead of once.
 */
export type CacheStageOptions = {
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
export function exactCacheStage(): Stage {
  return {
    name: "cache",
    when: (ctx: AskContext) => !ctx.isFollowUp,
    async run(ctx: AskContext): Promise<Answer | null> {
      // The version comes from the request, never from this stage. See
      // `cacheVersion` on `AskContext`: a reader and a writer that disagree
      // about it never share an entry again.
      const cached = await ctx.cache.get<CachedAnswer>(answerKey(ctx.question, ctx.cacheVersion))
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
      answerKey(ctx.question, ctx.cacheVersion),
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
