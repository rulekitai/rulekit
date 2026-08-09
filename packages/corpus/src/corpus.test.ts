import assert from "node:assert/strict"
import { dirname, resolve } from "node:path"
import { before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { JsonStore } from "./json-store.ts"
import { checkIntegrity, loadCorpus } from "./load.ts"
import { SqliteStore } from "./sqlite-store.ts"
import type { RuleStore } from "./store.ts"
import { ftsQuery, nameStem, normalizeName, normalizeQuestion, normalizeRuleNumber } from "./text.ts"
import type { Corpus } from "./types.ts"

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../data/demo")

describe("text", () => {
  test("folds a name to a lookup key", () => {
    assert.equal(normalizeName("Stonewall Sentry, Awakened"), "stonewall sentry awakened")
    assert.equal(normalizeName("Ka’Tel’s Oath"), "katels oath")
    assert.equal(normalizeName("  Éclair  "), "eclair")
  })

  test("files a printed name under the part before the comma", () => {
    assert.equal(nameStem("Stonewall Sentry, Awakened"), "stonewall sentry")
    assert.equal(nameStem("Lanternbearer"), "lanternbearer")
  })

  test("folds a rule number's case only", () => {
    assert.equal(normalizeRuleNumber("300.2.A"), "300.2.a")
  })

  test("collapses trivial question variants without merging distinct ones", () => {
    assert.equal(normalizeQuestion("Is Borrowed Hour banned?"), "is borrowed hour banned")
    assert.equal(normalizeQuestion("is  borrowed   hour banned"), "is borrowed hour banned")
    assert.notEqual(normalizeQuestion("is A banned"), normalizeQuestion("is B banned"))
  })

  test("quotes every token so punctuation cannot become query syntax", () => {
    const query = ftsQuery("What does Guard do?")
    assert.ok(query)
    assert.ok(!query.includes("?"))
    assert.ok(query.includes('"guard"'))
  })

  test("keeps a rule number as one token", () => {
    assert.equal(ftsQuery("rule 300.2.a"), '"rule" OR "300.2.a"')
  })

  test("returns null when nothing searchable is left", () => {
    assert.equal(ftsQuery("   "), null)
    assert.equal(ftsQuery("!!! ???"), null)
  })

  test("falls back to common words rather than giving up", () => {
    // "what is it" is all stopwords. Returning null would be read as "no
    // results", which is a worse answer than a weak one.
    assert.ok(ftsQuery("what is it"))
  })
})

describe("loading the demo corpus", () => {
  let corpus: Corpus

  before(async () => {
    const result = await loadCorpus(DEMO)
    assert.ok(result.ok, `demo corpus failed to load: ${JSON.stringify(result.problems, null, 2)}`)
    corpus = result.corpus
  })

  test("parses every row with no problems", async () => {
    const result = await loadCorpus(DEMO)
    assert.deepEqual(result.problems, [])
  })

  test("every link points at something that exists", () => {
    assert.deepEqual(checkIntegrity(corpus), [])
  })

  test("holds both rulebooks and every collection", () => {
    assert.equal(corpus.game.slug, "paper-kingdoms")
    assert.equal(corpus.rulebooks.length, 2)
    assert.ok(corpus.rules.length >= 25)
    assert.ok(corpus.cards.length >= 12)
    assert.ok(corpus.terms.length >= 6)
    assert.ok(corpus.errata.length >= 2)
    assert.ok(corpus.banlist.length >= 3)
    assert.ok(corpus.patchNotes.length >= 2)
  })

  test("refuses a corpus whose version it does not know", async () => {
    const result = await loadCorpus(resolve(DEMO, "..", "does-not-exist"))
    assert.equal(result.ok, false)
    assert.equal(result.problems[0]?.file, "game.json")
  })
})

/**
 * Both stores answer the same questions the same way.
 *
 * This suite runs twice, once per implementation. That is the whole point: the
 * store interface is only a real contract if two implementations satisfy it, and
 * a reader who swaps one for the other must not get different answers.
 */
for (const kind of ["sqlite", "json"] as const) {
  describe(`${kind} store`, () => {
    let store: RuleStore

    before(async () => {
      const result = await loadCorpus(DEMO)
      assert.ok(result.ok)
      store = kind === "sqlite" ? SqliteStore.fromCorpus(result.corpus) : new JsonStore(result.corpus)
    })

    test("names the game", async () => {
      assert.equal((await store.game()).slug, "paper-kingdoms")
    })

    test("finds a rule by its number", async () => {
      const rule = await store.getRuleByNumber("300.2.a")
      assert.equal(rule?.id, "r-300-2-a")
      assert.match(rule?.content ?? "", /Guard/)
    })

    test("folds the case of a rule number", async () => {
      assert.equal((await store.getRuleByNumber("300.2.A"))?.id, "r-300-2-a")
    })

    test("prefers the primary rulebook when a number repeats", async () => {
      // 100.1 exists in both books. Without a stable order this test is a coin
      // flip, and a reader asking for "rule 100.1" gets tournament text.
      assert.equal((await store.getRuleByNumber("100.1"))?.rule_book_id, "book-core")
      assert.equal((await store.getRuleByNumber("100.1", { ruleBookId: "book-tournament" }))?.id, "r-t100-1")
    })

    test("finds a rule by slug", async () => {
      assert.equal((await store.getRuleBySlug("lethal-damage"))?.rule_number, "300.3.a")
    })

    test("walks the hierarchy in both directions", async () => {
      const children = await store.getChildren("r-300-3")
      assert.deepEqual(
        children.map((r) => r.rule_number),
        ["300.3.a", "300.3.b"],
      )
      assert.equal((await store.getParent("r-300-3-a"))?.id, "r-300-3")
      const siblings = await store.getSiblings("r-300-3-a")
      assert.deepEqual(
        siblings.map((r) => r.rule_number),
        ["300.3.b"],
      )
    })

    test("gives a top-level rule its book's other top-level rules as siblings", async () => {
      // A root rule has a null parent. Matching a null with `=` is never true,
      // so this returned nothing until the query used IS NULL.
      const siblings = await store.getSiblings("r-300-1")
      assert.ok(siblings.length > 0)
      assert.ok(siblings.every((r) => r.rule_book_id === "book-core" && !r.parent_id))
      assert.ok(!siblings.some((r) => r.id === "r-300-1"))
    })

    test("resolves cross-references inside the same rulebook", async () => {
      const related = await store.getRelated("r-300-2")
      assert.deepEqual(related.map((r) => r.rule_number).sort(), ["300.3", "800.1"])
      assert.ok(related.every((r) => r.rule_book_id === "book-core"))
    })

    test("ranks a keyword question onto the rule that defines it", async () => {
      const hits = await store.searchRules("what does Guard do")
      assert.ok(hits.length > 0)
      assert.ok(
        hits.slice(0, 3).some((r) => r.rule_number === "800.1"),
        `expected 800.1 near the top, got ${hits
          .slice(0, 3)
          .map((r) => r.rule_number)
          .join(", ")}`,
      )
    })

    test("keeps superseded rules out of search results", async () => {
      const hits = await store.searchRules("starting life total")
      assert.ok(hits.some((r) => r.rule_number === "100.4"))
      assert.ok(
        !hits.some((r) => r.rule_number === "100.5"),
        "a deprecated rule quoted as current is a wrong answer, not an incomplete one",
      )
    })

    test("still reaches a superseded rule by number", async () => {
      assert.equal((await store.getRuleByNumber("100.5"))?.is_deprecated, true)
    })

    test("keeps bare section headers out of search results", async () => {
      const hits = await store.searchRules("keyword glossary")
      assert.ok(!hits.some((r) => r.id === "r-800-0"))
    })

    test("returns nothing rather than everything for an unsearchable question", async () => {
      assert.deepEqual(await store.searchRules("   "), [])
    })

    test("scores higher for a better match", async () => {
      const hits = await store.searchRules("blocking")
      assert.ok(hits.length > 1)
      for (let i = 1; i < hits.length; i++) {
        assert.ok((hits[i - 1] as { score: number }).score >= (hits[i] as { score: number }).score)
      }
    })

    test("finds a term by its printed name and by an alias", async () => {
      assert.equal((await store.getTerm("Guard"))?.id, "term-guard")
      assert.equal((await store.getTerm("Guardian"))?.id, "term-guard")
      assert.equal((await store.getTerm("guard"))?.id, "term-guard")
    })

    test("answers an exact term search with that term alone", async () => {
      const found = await store.searchTerms("Swift")
      assert.equal(found[0]?.id, "term-swift")
    })

    test("reads a card by exact name before anything else", async () => {
      const found = await store.searchCards("Stonewall Sentry")
      assert.equal(found[0]?.id, "pk-001")
    })

    test("reaches every printing filed under a name", async () => {
      const found = await store.searchCards("Stonewall Sentry")
      assert.ok(
        found.some((c) => c.id === "pk-002"),
        "the second printing must be reachable by the shared name",
      )
    })

    test("hydrates cards in the order asked and omits unknown ids", async () => {
      const cards = await store.getCards(["pk-003", "nope", "pk-001"])
      assert.deepEqual(
        cards.map((c) => c.id),
        ["pk-003", "pk-001"],
      )
    })

    test("keeps every text box on a gear card, and its stats", async () => {
      const [gear] = await store.getCards(["pk-006"])
      assert.equal(gear?.text.card_text, "Equip 2.")
      assert.equal(gear?.text.effect_text, "The equipped unit has Guard.")
      assert.ok(gear?.text.attach_text)
      // A number stays a number. SQLite columns are TEXT, so a stat that came
      // back as "2" would compare equal to nothing and sort as a string.
      assert.equal(gear?.stats.might_bonus, 2)
    })

    test("carries no key the card does not use", async () => {
      // The point of the two maps: a game writes the keys it has, and a card
      // that prints no flavour text has no flavour key rather than a null one.
      const [gear] = await store.getCards(["pk-006"])
      assert.ok(!("flavor_text" in (gear?.text ?? {})))
      assert.ok(!("might" in (gear?.stats ?? {})))
    })

    test("finds a card by its printed text, not only its name", async () => {
      const found = await store.searchCards("cannot be blocked by units with Guard")
      assert.ok(found.some((c) => c.id === "pk-012"))
    })

    test("lists every printed name as proof a card exists", async () => {
      const names = await store.allCardNames()
      assert.equal(names.length, 12)
      assert.ok(names.every((n) => n.id && n.name))
    })

    test("reads the banlist by card name", async () => {
      const rows = await store.listBanlist({ cardName: "Borrowed Hour" })
      assert.equal(rows.length, 1)
      assert.equal(rows[0]?.entry_type, "banned")
      assert.equal(rows[0]?.effective_date, "2026-03-01")
    })

    test("filters the banlist by format", async () => {
      const open = await store.listBanlist({ format: "open" })
      assert.deepEqual(
        open.map((b) => b.card?.name),
        ["Stonewall Sentry, Awakened"],
      )
    })

    test("reads errata by card name", async () => {
      const rows = await store.listErrata({ cardName: "Lanternbearer" })
      assert.equal(rows.length, 1)
      assert.match(rows[0]?.errata_text ?? "", /units you control/)
    })

    test("reads a patch note by slug", async () => {
      assert.equal((await store.getPatchNote("v1-2-rules-update"))?.version, "1.2")
    })

    test("searches every kind at once", async () => {
      const result = await store.searchAll("Borrowed Hour")
      assert.ok(result.banlist.length > 0, "a banned card must reach the banlist")
      assert.ok(result.errata.length > 0, "a card with errata must reach the errata")
    })

    test("finds the keyword rule and the glossary term in one search", async () => {
      const result = await store.searchAll("Bolster")
      assert.ok(result.terms.some((t) => t.id === "term-bolster"))
      assert.ok(result.rules.some((r) => r.rule_number === "800.3"))
    })
  })
}
