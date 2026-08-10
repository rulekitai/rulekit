import { normalizeName } from "@rulekitai/corpus/text"

/**
 * Deciding what a question is asking, before any model runs.
 *
 * Some questions are a row lookup, not a reasoning job. "Is this card banned?"
 * and "what does rule 300.2 say?" both have an answer sitting in a table, and
 * reading it is faster, free, and impossible to get creatively wrong.
 *
 * PRECISION OVER RECALL, EVERYWHERE. A question this cannot classify confidently
 * returns NONE and falls through to the agent, which can answer it. A question
 * it classifies WRONGLY produces a confident cited answer about the wrong thing,
 * and nothing downstream checks it. Every closed word list below is closed for
 * that reason: one wildcard, and "is the red one banned" resolves "the red" and
 * answers about a card nobody asked about.
 */

export type StaticIntent = "RULE_N" | "BANNED" | "BANLIST" | "ERRATA" | "NONE"

export type Classification = {
  intent: StaticIntent
  ruleNumber?: string
  /** The folded card name the question named. */
  cardKey?: string
  /** What the reader typed, so an answer can use their capitalisation. */
  cardRaw?: string
  /** A legality question that also asks whether the text changed. */
  alsoErrata?: boolean
  /** The clause that asked about the text, which may name a different card. */
  errataClause?: string
}

/**
 * The patterns that vary between games.
 *
 * Every game numbers its rules differently, names its formats differently, and
 * has its own words for "may I play this". Defaults suit a numbered rulebook
 * with a banned list; override what does not fit.
 */
export type ClassifyConfig = {
  /** A rule number, as a regular-expression source. */
  ruleNumberPattern: string
  /** Words that make a question a legality question. */
  legalityWords: string[]
  /** Format names, so "in standard" is dropped rather than read as a card name. */
  formatWords: string[]
}

export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = {
  ruleNumberPattern: String.raw`\d{1,3}(?:\.\d{1,3})?(?:\.[a-z])?(?:\.\d+)?`,
  legalityWords: [
    "banned",
    "restricted",
    "legal",
    "illegal",
    "allowed",
    "playable",
    "unplayable",
    "ban ?list",
  ],
  formatWords: ["constructed", "draft", "limited", "sealed", "standard", "commander", "open"],
}

/**
 * A second clause starts here.
 *
 * "can i play X and has its text been changed" asks two questions, and the card
 * name ends at the conjunction. Name folding already turned a comma into a
 * space, so the comma form arrives here too.
 */
const CLAUSE_BREAK = /\s+(?:and|or|but|then|also)\s+/

/**
 * A question asking whether the printed text changed.
 *
 * Matched against the WHOLE question, never against a card name: a card really
 * can be called "Changing Seasons", and matching the name would make every
 * question about it a text question.
 */
const ERRATA_CUE =
  /\berrat(?:a|um)\b|\btext\b[^.?!]*\bchang|\bchang\w*\b[^.?!]*\btext\b|\brework(?:ed|ing)?\b/

/**
 * Words a reader puts between a card name and the legality word, and the words a
 * question opens with. Both CLOSED.
 */
const TRAILING_FILLER = new Set([
  "still",
  "currently",
  "ever",
  "actually",
  "really",
  "now",
  "yet",
  "today",
  "been",
  "is",
  "are",
  "was",
  "were",
  "be",
  // "is X on the ban list" captures "X on the". The preposition and the article
  // carry no card, and the literal key is tried before them anyway.
  "on",
  "in",
  "the",
  "a",
  "an",
])

const LEADING_FILLER = new Set([
  "has",
  "have",
  "had",
  "was",
  "were",
  "is",
  "are",
  "tell",
  "me",
  "if",
  "whether",
])

/**
 * The words a text question is built from, around the card it names. CLOSED, so
 * "has the red one been reworked" cannot resolve "the red" and make a claim
 * about the wrong card.
 */
const ERRATA_CLAUSE_FILLER = new Set([
  "it",
  "its",
  "this",
  "that",
  "any",
  "anything",
  "something",
  "been",
  "being",
  "get",
  "got",
  "text",
  "wording",
  "rules",
  "printed",
  "current",
  "change",
  "changed",
  "changes",
  "changing",
  "rework",
  "reworked",
  "reworks",
  "reworking",
  "errata",
  "erratum",
  "update",
  "updated",
  "there",
])

/** Build the patterns one config produces. Compiled once per config. */
function patterns(config: ClassifyConfig) {
  const legality = config.legalityWords.join("|")
  const formats = config.formatWords.join("|")
  return {
    ruleInline: new RegExp(String.raw`\brule\s+(${config.ruleNumberPattern})\b`),
    ruleBare: new RegExp(String.raw`^(${config.ruleNumberPattern})\??$`),
    wholeBanlist: new RegExp(
      String.raw`^(?:the\s+|current\s+|show\s+(?:me\s+)?the\s+|what(?:'?s| is| are)\s+(?:on\s+)?the\s+)*ban\s?list\??$` +
        String.raw`|^what\s+cards?\s+(?:is|are)\s+banned\??$|^what\s+(?:is|are)\s+banned\??$`,
    ),
    // The format words are listed rather than matched as "anything after in",
    // because a card really can be named "Trouble in Paradise" and a wildcard
    // would cut that name in half.
    trailingFormat: new RegExp(String.raw`\s+in\s+(?:${formats})$`),
    legalitySubjects: [
      new RegExp(String.raw`\b(?:is|are|was|were)\s+(.+?)\s+(?:been\s+)?(?:${legality})\b`),
      /\bban(?:\s?list)?\s+status\s+(?:of|for)\s+(.+?)$/,
      /\b(?:can|may)\s+i\s+(?:play|use|run)\s+(.+?)$/,
      new RegExp(String.raw`^(.+?)\s+(?:${legality})\b`),
    ],
  }
}

function cardEntity(intent: StaticIntent, raw: string, trailingFormat: RegExp): Classification {
  const text = String(raw ?? "")
    .replace(/[?.!,]+$/, "")
    .replace(trailingFormat, "")
    .trim()
  if (!text) return { intent: "NONE" }
  return { intent, cardKey: normalizeName(text), cardRaw: text }
}

/** The text a legality question names as its subject, or null. */
function legalitySubject(text: string, subjects: RegExp[]): string | null {
  for (const pattern of subjects) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

/**
 * Classify a question into a static intent and the thing it named.
 *
 * BANNED is returned for ANY question that names something and asks a legality
 * word about it, whether or not that thing turns out to be on the list. The
 * ABSENCE of a row is an answer the data can give, and routing that case to a
 * model is what produces a confident verdict with nothing behind it.
 */
export function classify(question: string, config: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG): Classification {
  const p = patterns(config)
  const q = String(question ?? "")
    .toLowerCase()
    .trim()

  // A rule number, named or bare.
  const ruleMatch = q.match(p.ruleInline) ?? q.match(p.ruleBare)
  if (ruleMatch?.[1]) return { intent: "RULE_N", ruleNumber: ruleMatch[1].trim().toLowerCase() }

  // The whole list. Checked before the card patterns, so "what is on the ban
  // list" cannot capture "what" as a card name.
  if (p.wholeBanlist.test(q)) return { intent: "BANLIST" }

  const clauses = q.split(CLAUSE_BREAK)
  const asked = clauses
    .map((clause) => ({ clause, subject: legalitySubject(clause, p.legalitySubjects) }))
    .filter((c): c is { clause: string; subject: string } => Boolean(c.subject))

  // TWO legality questions in one sentence. "Is A banned or is B banned?" asks
  // about two cards, and the single-subject capture is non-greedy: it stops at
  // the first legality word, so the second card never reached the resolver and a
  // verdict about one card read as a verdict about both.
  if (asked.length > 1) {
    const parts = asked.map((c) => cardEntity("BANNED", c.subject, p.trailingFormat))
    if (parts.some((part) => part.intent === "NONE")) return { intent: "NONE" }
    return {
      intent: "BANNED",
      cardKey: parts.map((part) => part.cardKey).join(" and "),
      cardRaw: parts.map((part) => part.cardRaw).join(" and "),
      alsoErrata: ERRATA_CUE.test(q),
    }
  }

  const subject = legalitySubject(q, p.legalitySubjects)
  if (subject !== null) {
    const entity = cardEntity("BANNED", subject, p.trailingFormat)
    if (entity.intent === "NONE") return entity
    if (!ERRATA_CUE.test(q)) return { ...entity, alsoErrata: false }
    // A legality question that ALSO asks about the text. Both halves are rows,
    // so answer both. The text half can name a card of its own, so it travels
    // separately: attributing it to the legality subject told a reader the
    // printed text of a card they never asked about was current.
    const legalityClause = asked[0]?.clause
    const textClauses = clauses.filter((clause) => clause !== legalityClause && ERRATA_CUE.test(clause))
    return { ...entity, alsoErrata: true, errataClause: textClauses.join(" and ") }
  }

  const errataMatch =
    q.match(/\berrat(?:a|um)\s+(?:on|for|to)\s+(.+?)$/) ?? q.match(/^(.+?)\s+errat(?:a|um)\b/)
  if (errataMatch?.[1]) return cardEntity("ERRATA", errataMatch[1], p.trailingFormat)

  return { intent: "NONE" }
}

/** Drop the listed opener and closer words. Never empties the key. */
export function trimFiller(text: string): string {
  let words = String(text ?? "")
    .split(" ")
    .filter(Boolean)
  while (words.length > 1 && LEADING_FILLER.has(words[0] as string)) words = words.slice(1)
  while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1] as string))
    words = words.slice(0, -1)
  return words.join(" ")
}

/**
 * The card name a TEXT question names, or "" when it names none.
 *
 * "has fury rune been reworked" names a card. "has its text been changed" names
 * nothing: it is about the card the other half of the sentence named. Telling
 * those apart is what keeps a text claim off a card nobody asked it about.
 *
 * Unlike `trimFiller` this MAY return "", because an empty key is the right
 * answer for a clause built entirely of pronouns.
 */
export function trimErrataClause(clause: string): string {
  const drop = (word: string) =>
    LEADING_FILLER.has(word) || TRAILING_FILLER.has(word) || ERRATA_CLAUSE_FILLER.has(word)
  let words = normalizeName(clause).split(" ").filter(Boolean)
  while (words.length && drop(words[0] as string)) words = words.slice(1)
  while (words.length && drop(words[words.length - 1] as string)) words = words.slice(0, -1)
  return words.join(" ")
}

/**
 * The keys to try for one named card, most literal first.
 *
 * The FIRST candidate is always the key exactly as it was captured, so a card
 * whose printed name really holds "and" or a filler word resolves itself before
 * any narrowing runs.
 */
export function cardKeyCandidates(cardKey: string): string[] {
  const base = String(cardKey ?? "").trim()
  if (!base) return []
  const seen = new Set<string>()
  const out: string[] = []
  const offer = (candidate: string) => {
    const key = candidate.trim()
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(key)
  }
  offer(base)
  for (const stem of [base, base.split(CLAUSE_BREAK)[0] ?? base]) {
    offer(stem)
    offer(trimFiller(stem))
  }
  return out
}

export { CLAUSE_BREAK, ERRATA_CUE }
