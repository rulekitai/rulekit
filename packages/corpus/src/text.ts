/**
 * Text handling shared by the loader, the builder, and every store.
 *
 * Two jobs live here. One is normalising a name so a reader's spelling reaches
 * the printed one. The other is turning a reader's whole question into a query
 * the full-text index will accept.
 */

const APOSTROPHES = /['’‘ʼ`]/g
const DIACRITICS = /[̀-ͯ]/g

/**
 * Fold a name to a lookup key: "Draven, Vanquisher" becomes "draven vanquisher".
 *
 * Readers type names without the accent, without the apostrophe, and with the
 * punctuation they happen to reach for. Folding all three away is what lets one
 * stored key answer every spelling of the same name.
 */
export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .replace(APOSTROPHES, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Fold a rule number: "103.1.B.2" becomes "103.1.b.2". */
export function normalizeRuleNumber(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
}

/**
 * Fold a whole question for exact-match caching.
 *
 * Conservative on purpose. It collapses the variants that mean the same thing —
 * a trailing question mark, a stray capital, a doubled space — and merges
 * nothing else. Two questions that fold together are served the same answer, so
 * a rule that folded too hard would hand one reader another reader's answer.
 */
export function normalizeQuestion(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .replace(APOSTROPHES, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[?.!]+$/, "")
    .trim()
}

/**
 * Words that carry no signal in a rules question.
 *
 * The list is CLOSED and short. Full-text ranking already scores a common word
 * near zero, so this exists to keep the query small rather than to change the
 * ranking. A longer list starts removing words that matter: "may", "must" and
 * "can" are load-bearing in a rulebook and are deliberately absent.
 */
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
])

/** Split text into index-shaped tokens. A rule number stays one token. */
export function tokenize(value: unknown): string[] {
  return (
    String(value ?? "")
      .toLowerCase()
      .match(/[\p{L}\p{N}][\p{L}\p{N}.'’-]*/gu)
      ?.map((token) => token.replace(/[.'’-]+$/, ""))
      .filter(Boolean) ?? []
  )
}

/**
 * Turn a reader's question into an FTS5 MATCH expression, or null.
 *
 * Two things make this necessary rather than optional. FTS5 reads bare
 * punctuation as its own query syntax, so an unescaped question mark or hyphen
 * is a syntax error that throws instead of returning nothing. And a reader's
 * question is a sentence, not a query, so the words are joined with OR and the
 * ranking decides which document wins.
 *
 * Returns null when nothing searchable is left. A caller must treat that as "no
 * results", never as "match everything".
 */
export function ftsQuery(question: unknown): string | null {
  const tokens = tokenize(question)
  const meaningful = tokens.filter((token) => !STOPWORDS.has(token))
  // A question built entirely of common words still deserves an attempt, so
  // fall back to the unfiltered tokens rather than returning nothing.
  const chosen = meaningful.length ? meaningful : tokens
  if (!chosen.length) return null
  // Every token is quoted, which makes FTS5 read it as a literal string rather
  // than as an operator. A doubled quote is the escape inside a quoted token.
  return chosen.map((token) => `"${token.replace(/"/g, '""')}"`).join(" OR ")
}

/**
 * The name a printed card is filed under, before any epithet.
 *
 * "Master Yi, Wuju Bladesman" files under "master yi". The comma is the boundary
 * a reader names a character at, and it is the only prefix treated as a name in
 * its own right. Without this a reader who types the character name matches no
 * printed card at all.
 */
export function nameStem(printedName: unknown): string {
  return normalizeName(String(printedName ?? "").split(",")[0])
}
