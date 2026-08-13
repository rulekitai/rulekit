import assert from "node:assert/strict"
import { copyFile, mkdtemp, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { JsonStore } from "./json-store.ts"
import { checkIntegrity, loadCorpus } from "./load.ts"
import { COLLECTION_SCHEMAS } from "./schema.ts"
import { SqliteStore } from "./sqlite-store.ts"
import type { RuleStore } from "./store.ts"
import { ftsQuery, nameStem, normalizeName, normalizeQuestion, normalizeRuleNumber } from "./text.ts"
import type { Corpus } from "./types.ts"

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../data/demo")

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
    assert.ok(corpus.rulings.length >= 6)
  })

  test("refuses a corpus whose version it does not know", async () => {
    const result = await loadCorpus(resolve(DEMO, "..", "does-not-exist"))
    assert.equal(result.ok, false)
    assert.equal(result.problems[0]?.file, "game.json")
  })
})

describe("a corpus written before rulings existed", () => {
  /** Copy the demo corpus, minus the files a case wants absent. */
  async function corpusWithout(...omit: string[]): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "rulekit-corpus-"))
    for (const file of await readdir(DEMO)) {
      if (!file.endsWith(".json") || omit.includes(file)) continue
      await copyFile(resolve(DEMO, file), resolve(dir, file))
    }
    return dir
  }

  test("loads with an empty rulings list rather than failing", async () => {
    // Every corpus on disk predates this collection. Requiring the file would
    // stop all of them loading, and the reader would blame their corpus.
    const dir = await corpusWithout("rulings.json")
    const result = await loadCorpus(dir)
    assert.ok(result.ok, `an absent rulings.json must load: ${JSON.stringify(result.problems)}`)
    assert.deepEqual(result.corpus.rulings, [])
    assert.deepEqual(result.problems, [])
  })

  test("still fails when a REQUIRED collection is absent", async () => {
    // The exception is one file wide. A missing cards.json is a broken corpus,
    // and reading it as "this game has no cards" would answer every card
    // question with silence.
    const dir = await corpusWithout("cards.json")
    const result = await loadCorpus(dir)
    assert.equal(result.ok, false)
    assert.ok(result.problems.some((p) => p.file === "cards.json" && p.message.includes("missing")))
  })
})

describe("rulings", () => {
  const ruling = (over: Record<string, unknown> = {}) => ({
    id: "g1",
    kind: "card",
    question: "Does it?",
    answer: "Yes.",
    cards: [{ id: "c1", name: "Knight" }],
    ...over,
  })

  test("drops a ruling with no answer, because it can answer nothing", () => {
    assert.equal(COLLECTION_SCHEMAS.rulings.safeParse(ruling({ answer: "" })).success, false)
    assert.equal(COLLECTION_SCHEMAS.rulings.safeParse(ruling({ question: "" })).success, false)
  })

  test("reads an absent kind as general, and folds the case of a written one", () => {
    assert.equal(COLLECTION_SCHEMAS.rulings.safeParse(ruling({ kind: undefined })).data?.kind, "general")
    assert.equal(COLLECTION_SCHEMAS.rulings.safeParse(ruling({ kind: " Policy " })).data?.kind, "policy")
  })

  test("REFUSES a kind it does not know rather than filing it as general", () => {
    // The one place this schema does not guess. A misspelt kind means the writer
    // said something specific and got it wrong, and quietly filing a card ruling
    // as general puts it where no card lookup reaches it.
    const parsed = COLLECTION_SCHEMAS.rulings.safeParse(ruling({ kind: "cards" }))
    assert.equal(parsed.success, false)
    assert.match(parsed.error?.issues[0]?.path.join(".") ?? "", /kind/)
  })

  test("treats a ruling as unofficial unless the corpus says otherwise", () => {
    assert.equal(COLLECTION_SCHEMAS.rulings.safeParse(ruling()).data?.is_official, false)
  })

  test("names every broken link a ruling can carry", () => {
    const base: Corpus = {
      game: { slug: "g", name: "G" },
      rulebooks: [],
      sections: [],
      rules: [],
      terms: [],
      cards: [],
      errata: [],
      banlist: [],
      patchNotes: [],
      rulings: [],
    }
    const parse = (over: Record<string, unknown>) => COLLECTION_SCHEMAS.rulings.parse(ruling(over))
    const problems = checkIntegrity({
      ...base,
      rulings: [
        parse({ id: "g-card", cards: [{ id: "nope", name: "Knight" }] }),
        parse({ id: "g-rule", rule_numbers: ["999.9"] }),
        parse({ id: "g-nocard", kind: "card", cards: [] }),
        parse({ id: "g-url", source_url: "http://example.com/x" }),
      ],
    }).map((p) => p.message)

    assert.ok(
      problems.some((m) => m.includes('"nope"') && m.includes("names no card")),
      `expected a dangling card id, got ${JSON.stringify(problems)}`,
    )
    assert.ok(
      problems.some((m) => m.includes('"999.9"') && m.includes("names no rule")),
      `expected a dangling rule number, got ${JSON.stringify(problems)}`,
    )
    assert.ok(
      problems.some((m) => m.includes("no card is named")),
      `expected a card ruling with no card, got ${JSON.stringify(problems)}`,
    )
    assert.ok(
      problems.some((m) => m.includes("https:")),
      `expected an http source_url to be refused, got ${JSON.stringify(problems)}`,
    )
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

    test("reads rulings by the name of a piece they mention", async () => {
      const rows = await store.listRulings?.({ cardName: "Stonewall Sentry" })
      assert.ok(rows?.some((r) => r.id === "rul-001"))
      // rul-004 names TWO pieces, and must be reachable from either of them.
      // A one-card-per-row index would file it under the first name only.
      assert.ok(rows?.some((r) => r.id === "rul-004"))
      assert.ok((await store.listRulings?.({ cardName: "Ironbrand Blade" }))?.some((r) => r.id === "rul-004"))
    })

    test("filters rulings by kind and by topic", async () => {
      const policy = await store.listRulings?.({ kind: "policy" })
      assert.ok(policy?.length)
      assert.ok(
        policy?.every((r) => r.kind === "policy"),
        "a kind filter must not let another kind through",
      )
      const topic = await store.listRulings?.({ topic: "deck registration" })
      assert.deepEqual(
        topic?.map((r) => r.id),
        ["rul-007"],
      )
    })

    test("ranks a ruling matched on its question above one matched on its answer", async () => {
      // The question is what a reader nearly repeats, so it carries the match.
      // Weighting the answer highly ranks every ruling about a popular mechanic
      // above the one that answers the question in front of you.
      const found = (await store.searchRulings?.("discard down to seven cards in hand")) ?? []
      assert.equal(found[0]?.id, "rul-006")
    })

    test("leaves a withdrawn ruling out of the search but keeps it reachable", async () => {
      const found = (await store.searchRulings?.("Lanternbearer opponent units Guard")) ?? []
      assert.ok(
        !found.some((r) => r.id === "rul-009"),
        "a withdrawn ruling must not answer a current question",
      )
      const listed = (await store.listRulings?.({ cardName: "Lanternbearer" })) ?? []
      assert.ok(
        listed.some((r) => r.id === "rul-009"),
        "a reader who asks for every ruling on a card is owed the withdrawn one, labelled",
      )
    })

    test("reaches rulings from a unified search", async () => {
      const result = await store.searchAll("Stonewall Sentry")
      assert.ok(result.rulings?.some((r) => r.id === "rul-001"))
    })
  })
}

describe("opening a database that is not there", () => {
  test("names the file and the command that writes it", () => {
    // A fresh clone holds the JSON and no database, and SQLite reports only
    // "unable to open database file". That names no cause and no cure.
    assert.throws(
      () => SqliteStore.open(resolve(DEMO, "no-such-corpus.db")),
      /rulekit build/,
      "the error must say which command builds it",
    )
  })
})

describe("two terms that answer to one word", () => {
  test("validation names the ambiguous spelling", async () => {
    // The glossary looks a term up by an exact key, so a shared key resolves by
    // whichever row comes back first. The reader then gets a definition that
    // depends on insertion order.
    const result = await loadCorpus(DEMO)
    assert.ok(result.ok)
    const clash = structuredClone(result.corpus)
    clash.terms = [
      { ...clash.terms[0], id: "t-a", term: "Alpha", aliases: ["shared word"] },
      { ...clash.terms[0], id: "t-b", term: "Beta", aliases: ["shared word"] },
    ]
    const problems = checkIntegrity(clash)
    assert.ok(
      problems.some((p) => p.message.includes("shared word") && p.message.includes("ambiguous")),
      `expected an ambiguity problem, got ${JSON.stringify(problems)}`,
    )
  })

  test("one term may keep many spellings of its own", () => {
    // Aliases are the point. Only a spelling claimed by a DIFFERENT term is a
    // problem.
    assert.deepEqual(
      checkIntegrity({
        game: { slug: "g", name: "G" },
        rulebooks: [],
        sections: [],
        rules: [],
        cards: [],
        errata: [],
        banlist: [],
        patchNotes: [],
        rulings: [],
        terms: [
          {
            id: "t",
            term: "Guard",
            slug: "guard",
            definition: "d",
            short_definition: null,
            category: null,
            aliases: ["guardian", "defender", "GUARD"],
            defining_rule_id: null,
            defining_rule_number: null,
          },
        ],
      }),
      [],
    )
  })
})

describe("a row that omits a field entirely", () => {
  test("loads, rather than being dropped", () => {
    // A union that includes `z.undefined()` accepts the VALUE undefined. It
    // does NOT accept a missing key: only `.optional()` does. A corpus writer
    // omits a field far more often than they write null into it, and without
    // this every chess piece was dropped for having no `rarity`.
    const parsed = COLLECTION_SCHEMAS.cards.safeParse({
      id: "c1",
      name: "Knight",
      text: { movement_text: "An L shape." },
      stats: { piece_value: 3 },
    })
    assert.ok(parsed.success, `a card with only its required fields must load: ${parsed.error?.message}`)
    assert.equal(parsed.data.rarity, null)
    assert.equal(parsed.data.png_uri, null)
    assert.deepEqual(parsed.data.tags, [])
    assert.equal(parsed.data.stats.piece_value, 3)
  })

  test("every collection accepts a row with only its required fields", () => {
    const minimal: Record<string, Record<string, unknown>> = {
      rulebooks: { id: "b" },
      sections: { id: "s", rule_book_id: "b" },
      rules: { id: "r", rule_book_id: "b" },
      terms: { id: "t", term: "Guard" },
      errata: { id: "e" },
      banlist: { id: "x" },
      "patch-notes": { id: "n" },
      cards: { id: "c", name: "Knight" },
      // A ruling needs both halves. A row with only an id could answer nothing,
      // so it is the one collection whose "minimal" row is three fields.
      rulings: { id: "g", question: "Does it?", answer: "Yes." },
    }
    for (const [name, row] of Object.entries(minimal)) {
      const schema = COLLECTION_SCHEMAS[name as keyof typeof COLLECTION_SCHEMAS]
      const parsed = schema.safeParse(row)
      assert.ok(parsed.success, `${name} rejected a minimal row: ${parsed.error?.message}`)
    }
  })
})
