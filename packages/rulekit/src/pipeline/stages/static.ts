import type { RuleStore } from "../../corpus/store.ts"
import { answerKey, DEFAULT_TTL_SECONDS } from "../cache.ts"
import type { Answer, AskContext, Stage } from "../types.ts"
import { type ClassifyConfig, classify, DEFAULT_CLASSIFY_CONFIG } from "./static-classify.ts"
import {
  indexStaticData,
  type RenderConfig,
  renderCardAnswer,
  renderRule,
  renderRulings,
  type StaticData,
} from "./static-render.ts"

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
    const [cardNames, banlist, errata, rulings] = await Promise.all([
      store.allCardNames().catch(() => null),
      store.listBanlist({ limit: 200 }).catch(() => null),
      store.listErrata({ limit: 200 }).catch(() => null),
      // A store written before rulings existed has no such method. That reads
      // as "this corpus has none", which withholds the answer rather than
      // failing the whole build.
      store.listRulings ? store.listRulings({ limit: 200 }).catch(() => null) : Promise.resolve([]),
    ])
    const data = indexStaticData({
      cardNames: cardNames ?? [],
      banlist: banlist ?? [],
      errata: errata ?? [],
      rulings: rulings ?? [],
      banlistLoaded: banlist !== null,
      errataLoaded: errata !== null,
      rulingsLoaded: rulings !== null,
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

/**
 * The ruling that asks the reader's exact question, rendered.
 *
 * A ruling carries the question it answers, in the words whoever published it
 * chose. That is the phrasing a reader is most likely to type, because it is the
 * phrasing they read on the publisher's page or tapped in a list of suggestions.
 * Sending it to a model to have the model find and repeat that same pair costs a
 * call and can only be less faithful than the pair itself.
 *
 * THE MATCH IS EQUALITY, not a search. `getRulingByQuestion` folds both sides for
 * case, spacing, accents, and a trailing question mark, and matches nothing else.
 * A question that is merely similar goes to the agent, which can read the rules
 * and weigh them, rather than being handed one publisher's answer to a question
 * nobody asked.
 */
async function rulingByQuestion(
  store: RuleStore,
  ctx: AskContext,
  renderConfig: RenderConfig,
): Promise<Answer | null> {
  // A store written before this lookup existed has no such method, which reads
  // as "no ruling asks this" and costs the reader nothing but a model call.
  if (!store.getRulingByQuestion) return null
  const ruling = await store.getRulingByQuestion(ctx.question).catch(() => null)
  if (!ruling) return null
  return {
    text: renderRulings([ruling], renderConfig),
    citations: [
      {
        ruling: ruling.id,
        card: ruling.cards.map((card) => card.name).filter(Boolean),
        ruleNumbers: ruling.rule_numbers,
        sourceName: ruling.source_name,
        sourceUrl: ruling.source_url,
        official: ruling.is_official,
      },
    ],
    source: "rulings",
    servedBy: "static",
    latencyMs: 0,
    model: null,
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
      const renderConfig = { linkScheme: ctx.profile.cards.enabled ? ctx.profile.cards.linkScheme : "" }

      // Rows first, then the published question and answer. The order matters
      // where both could answer: a banned-list row is the current verdict, and a
      // ruling is one publisher reading the text on one day, so the row wins.
      const answer = (await fromRows()) ?? (await rulingByQuestion(store, ctx, renderConfig))
      if (!answer) return null
      // Write it back so the same question costs nothing next time, even though
      // producing it cost nothing this time: the classifier and the index build
      // are still work, and a popular question repeats a great deal.
      await ctx.cache
        .set(
          answerKey(ctx.question, ctx.cacheVersion),
          { text: answer.text, citations: answer.citations, source: answer.source },
          DEFAULT_TTL_SECONDS,
        )
        .catch((err) => console.error("[rulekit] static write-back failed:", err))
      return answer

      /** The half of this stage that reads a row the question points straight at. */
      async function fromRows(): Promise<Answer | null> {
        const c = classify(ctx.question, config)
        if (c.intent === "NONE") return null

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
        return {
          text: rendered.text,
          citations: rendered.citations,
          source: rendered.source,
          servedBy: "static",
          latencyMs: 0,
          model: null,
        }
      }
    },
  }
}
