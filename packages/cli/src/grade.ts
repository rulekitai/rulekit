import type { RuleStore } from "@rulekit/corpus/store"

/**
 * Grading an answer, as pure functions.
 *
 * Nothing here calls a model. That is the point: the checks that decide whether
 * an answer may ship are deterministic, free, and testable without spending
 * anything, so they can be trusted and re-run.
 *
 * TWO FAILURES DISQUALIFY AN ANSWER, and they are the same lie told two ways.
 *
 * A cited rule number the corpus does not hold was invented. A confidently
 * cited wrong rule reads exactly like a correct one, and a reader has no way to
 * tell them apart without going and looking, which is the work they came here to
 * avoid.
 *
 * A quoted passage that appears nowhere in the corpus was also invented. This is
 * the worse of the two and the one a number-only check misses entirely: a real
 * rule number attached to made-up text is the same lie wearing a citation.
 *
 * Recall is REPORTED AND NEVER A GATE. An answer can cite four of seven expected
 * rules and be completely right, so failing it on recall would reject good work.
 */

export type EvalQuestion = {
  id: string
  question: string
  category: string
  difficulty: string
  expected_rule_numbers: string[]
  rubric: string
}

/**
 * What counts as a rule citation in an answer.
 *
 * At least one dot segment is required, so "25 life" and "2026-03-01" are not
 * mistaken for rule numbers. Games number rules differently, so a corpus can
 * override it.
 */
export const DEFAULT_RULE_PATTERN = String.raw`\b\d{1,4}(?:\.\d+|\.[a-z])+\b`

/**
 * Fold text so two renderings of the same sentence compare equal.
 *
 * Corpus text is plain; an answer is Markdown, and it arrives with emphasis
 * markers, curly quotation marks, and dashes a keyboard did not produce. Folding
 * both sides is what stops a correctly quoted rule reading as invented.
 */
export function foldWhitespace(text: string): string {
  return (
    String(text ?? "")
      // Emphasis, quotation marks, and the backslashes a model uses to escape a
      // quotation mark INSIDE a quotation are all how it renders text, not part
      // of what the rulebook says. Removing them from BOTH sides is what lets a
      // quoted rule compare equal to the rule.
      //
      // The backslash matters more than it looks: a rule whose own text carries
      // quotation marks comes back as `It is formatted as \"Deflect [X]\".`,
      // and leaving the escapes in scored a perfect quotation at zero.
      .replace(/[*_`"“”\\]/g, "")
      .replace(/[‘’ʼ]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
  )
}

/**
 * How much of a quotation must be real corpus text.
 *
 * Not all of it, and that is the whole design. A model frames a quotation with
 * its citation, joins two rules into one line, and writes `**814.1**:` in front
 * of it — none of which is the rulebook's text and none of which is a lie. An
 * all-or-nothing test reported every one of those as an invention.
 *
 * Measured against a real model over eighteen questions: a correctly quoted
 * rule with framing lands above 90%, and every genuine alteration — a word
 * changed inside quotation marks, a card's text paraphrased and presented as a
 * quotation — landed between 42% and 79%.
 */
const MIN_QUOTE_COVERAGE = 0.8

/**
 * Uncovered characters a quotation may carry regardless of its ratio.
 *
 * Framing is a fixed cost and a quotation is not, so a ratio alone punishes a
 * short quotation for the same citation a long one absorbs. About forty
 * characters is what a citation and a short parenthetical occupy.
 */
const FRAMING_ALLOWANCE_CHARS = 40

/**
 * The shortest run that counts toward coverage.
 *
 * Below this, a run is a common phrase that appears in almost any rulebook by
 * chance, and counting it would let an invented quotation accumulate coverage
 * out of fragments like "the player may".
 */
const MIN_RUN_CHARS = 20

/**
 * Whether a quoted passage is really in the corpus.
 *
 * A model frames a quote with its citation, and it frames it differently every
 * time: `**430.4.a**: "..."`, `**430.4.a** "..."`, `Rule 100.1 — ...`. The first
 * version of this parsed the framing off, and every framing it had not
 * anticipated marked a correctly quoted rule as invented. Four real quotes were
 * flagged on the grader's first live run.
 *
 * So this does not parse framing. It asks whether the quote, or the quote with a
 * few leading words dropped, appears in the corpus. Dropping leading words
 * cannot hide a fabrication: whatever remains still has to be text somebody
 * really wrote, and it still has to be long enough to mean something.
 */
/**
 * The share of a quotation that is really corpus text.
 *
 * Walks the quotation greedily: at each word, take the longest run from there
 * that appears in the corpus, count it, and continue after it. A quotation made
 * of two real rules therefore scores as two covered runs rather than as one
 * failed match, which is right — the model quoted two rules, it did not invent
 * anything.
 *
 * Returns a number between 0 and 1.
 */
export function quoteCoverage(quote: string, haystack: string): { ratio: number; uncovered: number } {
  const folded = foldWhitespace(quote)
  const words = folded.split(" ").filter(Boolean)
  if (!words.length) return { ratio: 0, uncovered: 0 }

  let covered = 0
  let i = 0
  while (i < words.length) {
    let bestEnd = -1
    // Longest first, so a run is never cut short by a shorter one inside it.
    for (let end = words.length; end > i; end--) {
      const candidate = words.slice(i, end).join(" ")
      if (candidate.length < MIN_RUN_CHARS) break
      if (haystack.includes(candidate)) {
        bestEnd = end
        covered += candidate.length
        break
      }
    }
    if (bestEnd === -1) {
      // This word starts no run worth counting. Skip it and try the next.
      i++
    } else {
      i = bestEnd
    }
  }
  return { ratio: Math.min(1, covered / folded.length), uncovered: Math.max(0, folded.length - covered) }
}

/**
 * Whether a quotation is grounded in the corpus.
 *
 * See MIN_QUOTE_COVERAGE for why this is a share and not an exact match.
 */
export function quoteIsGrounded(quote: string, haystack: string): boolean {
  const { ratio, uncovered } = quoteCoverage(quote, haystack)
  // Either test passing is enough. The ratio catches a long quotation with a
  // sentence altered inside it; the allowance stops a short true quotation
  // failing because its citation is a large share of a small thing.
  return ratio >= MIN_QUOTE_COVERAGE || uncovered <= FRAMING_ALLOWANCE_CHARS
}

/** Every rule-number-shaped token in an answer, de-duplicated, in order. */
export function extractRuleNumbers(answer: string, pattern = DEFAULT_RULE_PATTERN): string[] {
  const found = String(answer ?? "").match(new RegExp(pattern, "gi")) ?? []
  return [...new Set(found.map((n) => n.trim().toLowerCase()))]
}

/**
 * Every quoted passage in an answer, one per blockquote line.
 *
 * LINE BY LINE, NOT BLOCK BY BLOCK. The check is a substring test against the
 * whole corpus, so a line that is genuinely part of a rule matches even when the
 * sentence wraps across several lines. Joining a block first would instead fail
 * whenever a model puts two different rules in one blockquote, which it does.
 *
 * Short lines are dropped: a handful of words appears in almost any corpus by
 * chance, so checking them produces noise rather than signal. That errs toward
 * not flagging, which is right for a gate that blocks a release.
 */
export function extractQuotes(answer: string, minChars = 40): string[] {
  const quotes: string[] = []
  for (const line of String(answer ?? "").split("\n")) {
    const quoted = line.match(/^\s*>\s?(.*)$/)
    if (!quoted) continue
    const text = (quoted[1] ?? "").trim()
    if (foldWhitespace(text).length >= minChars) quotes.push(text)
  }
  return quotes
}

/**
 * The text a quote may have come from.
 *
 * A model quotes a rule, but it also quotes a defined term, a card's changed
 * text, and the reason a card is banned. All four are corpus text, and checking
 * only rules would mark a correctly quoted glossary entry as invented.
 */
async function corpusText(store: RuleStore): Promise<string[]> {
  const [terms, errata, banlist, notes, cardNames] = await Promise.all([
    store.listTerms({ limit: 200 }),
    store.listErrata({ limit: 200 }),
    store.listBanlist({ limit: 200 }),
    store.listPatchNotes({ limit: 50 }),
    store.allCardNames(),
  ])

  // CARD TEXT BELONGS IN HERE, and leaving it out was a real defect: three
  // answers quoted a card correctly and were reported as inventions, because a
  // haystack of rules alone cannot contain a card's printed text.
  const cards = await store.getCards(cardNames.map((c) => c.id).slice(0, 200))
  const rest = cardNames.slice(200)
  for (let i = 0; i < rest.length; i += 200) {
    cards.push(...(await store.getCards(rest.slice(i, i + 200).map((c) => c.id))))
  }

  return [
    ...terms.flatMap((t) => [t.definition, t.short_definition ?? ""]),
    ...errata.flatMap((e) => [e.errata_text ?? "", e.original_text ?? "", e.explanation ?? ""]),
    ...banlist.map((b) => b.reason ?? ""),
    ...notes.flatMap((n) => [n.summary ?? "", n.body ?? ""]),
    ...cards.flatMap((c) => Object.values(c.text)),
  ].filter(Boolean)
}

/**
 * Every piece of corpus text, folded, as one searchable haystack.
 *
 * `listRules` caps at 200 per call, so the whole corpus is paged. This is built
 * ONCE per evaluation run and reused for every question: a rulebook of a few
 * thousand rules is a few megabytes of text, and rebuilding it per answer would
 * dominate the run.
 */
export async function buildHaystack(store: RuleStore): Promise<string> {
  const parts: string[] = []
  let offset = 0
  while (true) {
    const page = await store.listRules({ limit: 200, offset })
    if (!page.length) break
    parts.push(...page.flatMap((r) => [r.content, r.example ?? "", r.title ?? ""]))
    offset += page.length
    // A store that ignores `offset` would loop for ever. Stop at a size no real
    // rulebook reaches rather than hanging.
    if (offset > 100_000) break
  }
  parts.push(...(await corpusText(store)))
  return foldWhitespace(parts.filter(Boolean).join("\n"))
}

export type Grade = {
  id: string
  category: string
  difficulty: string
  /** Rule numbers cited that the corpus does not hold. Any is a failure. */
  fabricatedRules: string[]
  /** Quoted passages found nowhere in the corpus. Any is a failure. */
  fabricatedQuotes: string[]
  /** Expected rules the answer cited, of those that exist in this corpus. */
  recalled: string[]
  /** Expected rules the answer did not cite. */
  missed: string[]
  /** Expected rules the corpus does not hold. An EVAL-SET bug, not a model one. */
  staleExpectations: string[]
  citedCount: number
  quoteCount: number
  answerChars: number
  /** True when nothing was fabricated. This is the gate. */
  clean: boolean
}

/**
 * Grade one answer.
 *
 * `haystack` comes from `buildHaystack`, built once for the run.
 */
export async function gradeAnswer(
  question: EvalQuestion,
  answer: string,
  store: RuleStore,
  haystack: string,
  pattern = DEFAULT_RULE_PATTERN,
): Promise<Grade> {
  const cited = extractRuleNumbers(answer, pattern)

  const fabricatedRules: string[] = []
  for (const number of cited) {
    if (!(await store.getRuleByNumber(number))) fabricatedRules.push(number)
  }

  const fabricatedQuotes = extractQuotes(answer).filter((quote) => !quoteIsGrounded(quote, haystack))

  // An expected rule the corpus does not hold cannot be recalled, and counting
  // it as a miss would blame the model for the evaluation set being out of date
  // with the rulebook it is graded against.
  const staleExpectations: string[] = []
  const live: string[] = []
  for (const number of question.expected_rule_numbers ?? []) {
    if (await store.getRuleByNumber(number)) live.push(number)
    else staleExpectations.push(number)
  }

  const citedSet = new Set(cited)
  const recalled = live.filter((n) => citedSet.has(n.toLowerCase()))
  const missed = live.filter((n) => !citedSet.has(n.toLowerCase()))

  return {
    id: question.id,
    category: question.category,
    difficulty: question.difficulty,
    fabricatedRules,
    fabricatedQuotes,
    recalled,
    missed,
    staleExpectations,
    citedCount: cited.length,
    quoteCount: extractQuotes(answer).length,
    answerChars: answer.length,
    clean: fabricatedRules.length === 0 && fabricatedQuotes.length === 0,
  }
}

export type Summary = {
  questions: number
  clean: number
  fabricatedRuleCount: number
  fabricatedQuoteCount: number
  /** Recall over every expected rule that exists in this corpus. */
  recall: number
  staleExpectationCount: number
}

export function summarise(grades: Grade[]): Summary {
  const recalled = grades.reduce((n, g) => n + g.recalled.length, 0)
  const expected = grades.reduce((n, g) => n + g.recalled.length + g.missed.length, 0)
  return {
    questions: grades.length,
    clean: grades.filter((g) => g.clean).length,
    fabricatedRuleCount: grades.reduce((n, g) => n + g.fabricatedRules.length, 0),
    fabricatedQuoteCount: grades.reduce((n, g) => n + g.fabricatedQuotes.length, 0),
    recall: expected ? recalled / expected : 0,
    staleExpectationCount: grades.reduce((n, g) => n + g.staleExpectations.length, 0),
  }
}
