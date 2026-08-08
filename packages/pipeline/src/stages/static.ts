import type { RuleStore } from "@rulekit/corpus/store"
import { answerKey, DEFAULT_TTL_SECONDS } from "../cache.ts"
import type { Answer, AskContext, Stage } from "../types.ts"
import { type ClassifyConfig, classify, DEFAULT_CLASSIFY_CONFIG } from "./static-classify.ts"
import { indexStaticData, renderCardAnswer, renderRule, type StaticData } from "./static-render.ts"

/**
 * Answers that are a row lookup, not a reasoning job.
 *
 * "What does rule 300.2 say?" and "Is this card banned?" both have an answer
 * sitting in a table. Reading it costs nothing, takes milliseconds, and cannot
 * be creatively wrong. Roughly one question in five is one of these.
 *
 * ONLY A STATICALLY SHAPED QUESTION TOUCHES THE DATA. The classifier runs first
 * and returns NONE for everything else, so the common case costs one regular
 * expression and stops.
 */

export type StaticStageOptions = {
  /** Patterns that vary by game. */
  classify?: Partial<ClassifyConfig>
  /** How long the card indexes are held before a reread. */
  dataTtlSeconds?: number
}

/**
 * Hold the card indexes for a while rather than rebuilding them per question.
 *
 * They are a few hundred kilobytes and change a few times a year. The expiry is
 * what lets an updated corpus land without a restart.
 */
function createDataLoader(store: RuleStore, ttlSeconds: number) {
  let cached: { data: StaticData; expiresAt: number } | null = null
  let inFlight: Promise<StaticData> | null = null

  async function build(): Promise<StaticData> {
    // Each list is read independently, because losing one must not cost the
    // answers the others can still give.
    const [cardNames, banlist, errata] = await Promise.all([
      store.allCardNames().catch(() => null),
      store.listBanlist({ limit: 200 }).catch(() => null),
      store.listErrata({ limit: 200 }).catch(() => null),
    ])
    const data = indexStaticData({
      cardNames: cardNames ?? [],
      banlist: banlist ?? [],
      errata: errata ?? [],
      banlistLoaded: banlist !== null,
      errataLoaded: errata !== null,
    })
    if (!cardNames) {
      console.error(
        "[rulekit] the card list did not load. A legality question about a card that no banned-list " +
          "or change row names will now fall through to the agent rather than being answered from rows.",
      )
    }
    return data
  }

  return async function load(): Promise<StaticData> {
    if (cached && cached.expiresAt > Date.now()) return cached.data
    // Concurrent callers share one rebuild. Without this, N questions arriving
    // on a cold cache each build their own copy of the same indexes.
    if (!inFlight) {
      inFlight = build().finally(() => {
        inFlight = null
      })
    }
    const data = await inFlight
    cached = { data, expiresAt: Date.now() + ttlSeconds * 1000 }
    return data
  }
}

export function staticAnswersStage(store: RuleStore, options: StaticStageOptions = {}): Stage {
  const config = { ...DEFAULT_CLASSIFY_CONFIG, ...options.classify }
  const load = createDataLoader(store, options.dataTtlSeconds ?? 900)

  return {
    name: "static",
    // A follow-up depends on the conversation, and a row lookup does not read
    // one. "Is it banned?" after another question is about something this stage
    // cannot see.
    when: (ctx: AskContext) => !ctx.isFollowUp,
    async run(ctx: AskContext): Promise<Answer | null> {
      const c = classify(ctx.question, config)
      if (c.intent === "NONE") return null

      const renderConfig = { linkScheme: ctx.profile.cards.enabled ? ctx.profile.cards.linkScheme : "" }

      if (c.intent === "RULE_N") {
        const rule = await store.getRuleByNumber(c.ruleNumber ?? "")
        if (!rule) return null
        return {
          text: renderRule(rule),
          citations: [{ ruleNumber: rule.rule_number }],
          source: "rule",
          servedBy: "static",
          latencyMs: 0,
          model: null,
        }
      }

      const data = await load()
      const rendered = renderCardAnswer(c, data, renderConfig)
      if (!rendered) return null

      const answer: Answer = {
        text: rendered.text,
        citations: rendered.citations,
        source: rendered.source,
        servedBy: "static",
        latencyMs: 0,
        model: null,
      }
      // Write it back so the same question costs nothing next time, even though
      // producing it cost nothing this time: the classifier and the index build
      // are still work, and a popular question repeats a great deal.
      await ctx.cache
        .set(
          answerKey(ctx.question),
          { text: answer.text, citations: answer.citations, source: answer.source },
          DEFAULT_TTL_SECONDS,
        )
        .catch((err) => console.error("[rulekit] static write-back failed:", err))
      return answer
    },
  }
}
