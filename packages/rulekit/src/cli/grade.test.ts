import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadCorpus } from "../corpus/load.ts"
import { SqliteStore } from "../corpus/sqlite-store.ts"
import type { RuleStore } from "../corpus/store.ts"
import {
  buildHaystack,
  DEFAULT_RULE_PATTERN,
  type EvalQuestion,
  extractQuotes,
  extractRuleNumbers,
  foldWhitespace,
  gradeAnswer,
  quoteCoverage,
  quoteIsGrounded,
  summarise,
} from "./grade.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const DEMO = resolve(ROOT, "data/demo")

describe("finding citations in an answer", () => {
  test("finds a rule number", () => {
    assert.deepEqual(extractRuleNumbers("See rule 300.2.a for blocking."), ["300.2.a"])
  })

  test("ignores an ordinary number", () => {
    // "25 life" and a date are not citations. A pattern that matched them would
    // report a fabrication on every answer that mentions a life total.
    assert.deepEqual(extractRuleNumbers("Each player begins with 25 life."), [])
    assert.deepEqual(extractRuleNumbers("Effective 2026-03-01."), [])
  })

  test("de-duplicates and folds case", () => {
    assert.deepEqual(extractRuleNumbers("300.2.A and 300.2.a and 300.2.A"), ["300.2.a"])
  })

  test("finds every citation, not every second one", () => {
    // A shared global regular expression keeps its index between calls and skips
    // alternate matches. This is the test that catches that.
    const answer = "100.1 then 200.1 then 300.1 then 400.1 then 500.1"
    assert.equal(extractRuleNumbers(answer).length, 5)
    assert.equal(extractRuleNumbers(answer).length, 5)
  })
})

describe("finding quotes in an answer", () => {
  test("reads one quote per line, so two rules in one block stay apart", () => {
    const answer =
      "> A deck contains exactly 40 cards and this line is long enough.\n> A deck may contain at most 3 copies of any card with a name.\n\nSo you are fine."
    assert.equal(extractQuotes(answer).length, 2)
  })

  test("keeps two blockquotes apart", () => {
    const answer =
      "> first quote that is long enough to be worth checking here\n\ntext\n\n> second quote that is also long enough to check"
    assert.equal(extractQuotes(answer).length, 2)
  })

  test("folds emphasis and quotation marks away on both sides", () => {
    assert.equal(foldWhitespace("A **bold** rule — with “quotes”"), "a bold rule - with quotes")
  })

  test("sees through every citation framing a model invents", () => {
    // Found the first time the grader ran live: four correctly quoted rules all
    // flagged, because the citation was compared against the corpus too. The
    // model writes the framing differently every time, so nothing parses it.
    const haystack = foldWhitespace(
      "A player Channels two Runes during the Channel Phase on their turn. " +
        "A deck contains exactly 40 cards, and that is the whole rule.",
    )
    for (const framing of [
      '**430.4.a**: "A player Channels two Runes during the Channel Phase on their turn."',
      '**430.4.a** "A player Channels two Runes during the Channel Phase on their turn."',
      "Rule 430.4.a — A player Channels two Runes during the Channel Phase on their turn.",
      "A player Channels two Runes during the Channel Phase on their turn.",
    ]) {
      assert.equal(quoteIsGrounded(framing, haystack), true, `framing not seen through: ${framing}`)
    }
  })

  test("an altered quotation fails, however small the change", () => {
    const haystack = foldWhitespace(
      "A deck contains exactly 40 cards and a deck may contain at most 3 copies of any card.",
    )
    assert.equal(
      quoteIsGrounded('**100.1** "A deck contains exactly 60 cards and there is no copy limit."', haystack),
      false,
    )
  })

  test("scores a quotation by how much of it is really corpus text", () => {
    const haystack = foldWhitespace("A deck contains exactly 40 cards, and that is the whole rule.")
    assert.equal(
      quoteCoverage("A deck contains exactly 40 cards, and that is the whole rule.", haystack).ratio,
      1,
    )
    assert.ok(quoteCoverage("Nothing here resembles the corpus in any way at all.", haystack).ratio < 0.2)
  })

  test("a quotation joining two real rules is not an invention", () => {
    // A model puts two rules on one line. Both are real, so nothing was
    // invented, and a test that demanded one exact match reported it as a lie.
    const haystack = foldWhitespace(
      "A deck contains exactly 40 cards, and that is the whole rule. " +
        "Separately: each player begins the game with 25 life and no cards in play.",
    )
    const joined =
      "A deck contains exactly 40 cards, and that is the whole rule. each player begins the game with 25 life and no cards in play."
    assert.equal(quoteIsGrounded(joined, haystack), true)
  })

  test("framing longer than a few words still passes", () => {
    const haystack = foldWhitespace(
      "Each player's Rune Pool empties. Any unspent Energy and Power are lost. See rule 165 for more.",
    )
    assert.equal(
      quoteIsGrounded(
        '**316.3** (step in the Ending Step): "Each player\'s Rune Pool empties. Any unspent Energy and Power are lost. See rule 165 for more."',
        haystack,
      ),
      true,
    )
  })

  test("drops a fragment too short to prove anything", () => {
    // A three-word quote appears in almost any corpus by chance, so checking it
    // produces noise rather than signal.
    assert.deepEqual(extractQuotes("> the unit"), [])
  })

  test("folds whitespace so a wrapped quote still matches", () => {
    assert.equal(foldWhitespace("A  rule\n  wrapped\tacross lines"), "a rule wrapped across lines")
  })
})

describe("grading against the demo corpus", () => {
  let store: RuleStore
  let haystack: string

  const question: EvalQuestion = {
    id: "T-01",
    question: "How many cards are in a deck?",
    category: "rule_lookup",
    difficulty: "easy",
    expected_rule_numbers: ["100.1", "100.1.a"],
    rubric: "MUST say 40 cards and the 3-copy limit.",
  }

  before(async () => {
    const loaded = await loadCorpus(DEMO)
    assert.ok(loaded.ok)
    store = SqliteStore.fromCorpus(loaded.corpus)
    haystack = await buildHaystack(store)
  })

  test("passes an answer that cites real rules and quotes them correctly", async () => {
    const answer =
      'A deck holds 40 cards (100.1).\n\n> **100.1**: "A deck contains exactly 40 cards. A deck may contain at most 3 copies of any card with the same name, unless that card says otherwise."\n\nTwo cards share a name by their printed names (100.1.a).'
    const grade = await gradeAnswer(question, answer, store, haystack)
    assert.deepEqual(grade.fabricatedRules, [])
    assert.deepEqual(grade.fabricatedQuotes, [])
    assert.equal(grade.clean, true)
    assert.deepEqual(grade.recalled.sort(), ["100.1", "100.1.a"])
  })

  test("catches a cited rule the corpus does not hold", async () => {
    // The disqualifying failure. A confidently cited wrong rule reads exactly
    // like a correct one to somebody who cannot check.
    const grade = await gradeAnswer(question, "A deck holds 40 cards (999.9.z).", store, haystack)
    assert.deepEqual(grade.fabricatedRules, ["999.9.z"])
    assert.equal(grade.clean, false)
  })

  test("catches invented text under a real rule number", async () => {
    // The worse failure, and the one a number-only check misses entirely: a real
    // citation wrapped around text nobody wrote.
    const answer =
      "Rule 100.1 says:\n\n> A deck contains exactly 60 cards and there is no limit on copies at all."
    const grade = await gradeAnswer(question, answer, store, haystack)
    assert.deepEqual(grade.fabricatedRules, [], "the number is real")
    assert.equal(grade.fabricatedQuotes.length, 1, "but the quote is not")
    assert.equal(grade.clean, false)
  })

  test("accepts a quote of a glossary definition, not only of a rule", async () => {
    // A model quotes defined terms too. Checking rules alone would mark a
    // correctly quoted glossary entry as invented.
    const answer =
      "> Guard is a keyword ability. While you control a unit with Guard, an attacking unit must be blocked by a unit with Guard before any unit without Guard may block."
    const grade = await gradeAnswer(question, answer, store, haystack)
    assert.deepEqual(grade.fabricatedQuotes, [])
  })

  test("separates an out-of-date expectation from a model failure", async () => {
    // An expected rule the corpus does not hold cannot be recalled. Counting it
    // as a miss blames the model for the evaluation set drifting.
    const stale: EvalQuestion = { ...question, expected_rule_numbers: ["100.1", "888.8"] }
    const grade = await gradeAnswer(stale, "A deck holds 40 cards (100.1).", store, haystack)
    assert.deepEqual(grade.staleExpectations, ["888.8"])
    assert.deepEqual(grade.recalled, ["100.1"])
    assert.deepEqual(grade.missed, [], "a rule that does not exist is not a miss")
    assert.equal(grade.clean, true)
  })

  test("an answer citing nothing is clean but recalls nothing", async () => {
    // Refusing to answer is a legitimate outcome and must not read as a
    // fabrication. It simply recalls nothing.
    const grade = await gradeAnswer(question, "I do not have that in the rules data.", store, haystack)
    assert.equal(grade.clean, true)
    assert.deepEqual(grade.recalled, [])
  })

  test("a corpus with different numbering can override the pattern", async () => {
    const answer = "See rule A-12 for this."
    const grade = await gradeAnswer(question, answer, store, haystack, String.raw`\bA-\d+\b`)
    assert.deepEqual(grade.fabricatedRules, ["a-12"])
  })

  test("the default pattern is the one the tests describe", () => {
    assert.equal(DEFAULT_RULE_PATTERN, String.raw`\b\d{1,4}(?:\.\d+|\.[a-z])+\b`)
  })
})

describe("summarising a run", () => {
  const grade = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over })
  function base() {
    return {
      id: "x",
      category: "c",
      difficulty: "d",
      fabricatedRules: [] as string[],
      fabricatedQuotes: [] as string[],
      recalled: ["1.1"],
      missed: ["1.2"],
      staleExpectations: [] as string[],
      citedCount: 1,
      quoteCount: 0,
      answerChars: 10,
      clean: true,
    }
  }

  test("counts clean answers and both kinds of fabrication", () => {
    const summary = summarise([
      grade(),
      grade({ fabricatedRules: ["9.9"], clean: false }),
      grade({ fabricatedQuotes: ["invented"], clean: false }),
    ])
    assert.equal(summary.questions, 3)
    assert.equal(summary.clean, 1)
    assert.equal(summary.fabricatedRuleCount, 1)
    assert.equal(summary.fabricatedQuoteCount, 1)
  })

  test("recall counts only rules that exist", () => {
    // Two grades, each recalling one of two live rules.
    assert.equal(summarise([grade(), grade()]).recall, 0.5)
  })

  test("reports zero recall rather than dividing by nothing", () => {
    assert.equal(summarise([grade({ recalled: [], missed: [] })]).recall, 0)
  })
})

describe("the shipped evaluation set", () => {
  test("parses and covers the categories that matter", () => {
    const file = JSON.parse(readFileSync(resolve(ROOT, "data/riftbound/eval.json"), "utf8"))
    assert.equal(file.schemaVersion, 1)
    assert.ok(file.items.length >= 18)
    const categories = new Set(file.items.map((q: EvalQuestion) => q.category))
    // A set that only asks answerable questions never tests a refusal, and
    // refusing well is half of what this assistant is for.
    assert.ok(categories.has("off_scope"), "must include questions that should be declined")
    assert.ok(categories.has("ambiguous"), "must include a question that should ask back")
    for (const q of file.items as EvalQuestion[]) {
      assert.ok(q.id && q.question && q.rubric, `${q.id} is missing a field`)
    }
  })
})
