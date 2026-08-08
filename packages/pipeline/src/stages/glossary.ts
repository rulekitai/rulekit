import type { RuleStore } from "@rulekit/corpus/store"
import { normalizeName } from "@rulekit/corpus/text"
import { answerKey, DEFAULT_TTL_SECONDS } from "../cache.ts"
import type { Answer, AskContext, Stage } from "../types.ts"

/**
 * "What is X?" answered from the glossary.
 *
 * A defined term has a written definition and a rule that defines it. That IS
 * the answer, quoted and cited, and no model can improve on it. Sending it to
 * one costs money and risks a paraphrase that changes what the term means.
 *
 * The tight part is deciding that a question really is a definition question.
 * The patterns below are anchored and closed: a question that merely mentions a
 * keyword must fall through, because "how does Guard interact with flying" is a
 * reasoning question that the definition alone answers wrongly.
 */

/** Ways a reader asks for a definition. Each captures the term. */
const DEFINITION_PATTERNS: RegExp[] = [
  /^what(?:'?s| is| are)\s+(?:the\s+)?(?:keyword\s+|ability\s+|term\s+)?(.+?)\??$/,
  /^what\s+does\s+(.+?)\s+(?:do|mean)\??$/,
  /^(?:define|explain)\s+(?:the\s+)?(?:keyword\s+|term\s+)?(.+?)\??$/,
  /^(?:how\s+does\s+)(.+?)\s+work\??$/,
  /^(.+?)\s+(?:keyword|definition)\??$/,
]

/**
 * A bare term, typed on its own.
 *
 * Bounded to three words so a whole question typed without a question mark does
 * not reach the glossary as though it were a term.
 */
const BARE_TERM = /^[\p{L}\p{N}][\p{L}\p{N}\s'’-]{0,40}$/u

/** The term a question is asking about, or null. */
export function definitionSubject(question: string): string | null {
  const q = String(question ?? "")
    .trim()
    .toLowerCase()
  if (!q) return null
  for (const pattern of DEFINITION_PATTERNS) {
    const match = q.match(pattern)
    const subject = match?.[1]?.trim()
    if (subject && subject.split(/\s+/).length <= 4) return subject
  }
  if (BARE_TERM.test(q) && q.split(/\s+/).length <= 3) return q
  return null
}

export function glossaryStage(store: RuleStore): Stage {
  return {
    name: "glossary",
    when: (ctx: AskContext) => !ctx.isFollowUp,
    async run(ctx: AskContext): Promise<Answer | null> {
      const subject = definitionSubject(ctx.question)
      if (!subject) return null

      // An EXACT term or alias only. A fuzzy match here would answer "what is
      // shielding" with the definition of a different keyword, confidently and
      // with a citation.
      const term = await store.getTerm(normalizeName(subject))
      if (!term?.definition) return null

      const rule = term.defining_rule_id ? await store.getRule(term.defining_rule_id) : null
      const cited = rule
        ? `\n\nDefined in rule ${rule.rule_number}${rule.title ? ` — ${rule.title}` : ""}.`
        : term.defining_rule_number
          ? `\n\nDefined in rule ${term.defining_rule_number}.`
          : ""
      const also = term.aliases.length ? `\n\nAlso written as: ${term.aliases.join(", ")}.` : ""

      const text = `**${term.term}**\n\n> ${term.definition.replace(/\n/g, "\n> ")}${cited}${also}`
      const answer: Answer = {
        text,
        citations: [{ term: term.term, ruleNumber: term.defining_rule_number }],
        source: "glossary",
        servedBy: "glossary",
        latencyMs: 0,
        model: null,
      }
      await ctx.cache
        .set(
          answerKey(ctx.question),
          { text, citations: answer.citations, source: answer.source },
          DEFAULT_TTL_SECONDS,
        )
        .catch((err) => console.error("[rulekit] glossary write-back failed:", err))
      return answer
    },
  }
}
