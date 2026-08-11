import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import type { AgentEvent } from "../agent/events.ts"
import { type Profile, parseProfile } from "../agent/profile.ts"
import { loadCorpus } from "../corpus/load.ts"
import { SqliteStore } from "../corpus/sqlite-store.ts"
import type { RuleStore } from "../corpus/store.ts"
import { answerKey, MemoryCache, NoopCache, SqliteCache } from "./cache.ts"
import { allGates, firstOf, fromEnv, fromHeader, openGate } from "./gate.ts"
import { createPipeline } from "./pipeline.ts"
import { type AgentLike, agentStage } from "./stages/agent.ts"
import { exactCacheStage, writeBack } from "./stages/cache.ts"
import { definitionSubject, glossaryStage } from "./stages/glossary.ts"
import { staticAnswersStage } from "./stages/static.ts"
import { classify, trimErrataClause, trimFiller } from "./stages/static-classify.ts"
import type { Answer, AskContext, Gate, Stage } from "./types.ts"

const DEMO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../data/demo")

/** An agent that answers with a fixed string. No model, no network. */
function fakeAgent(text: string, options: { fail?: string; complete?: boolean } = {}): AgentLike {
  return {
    async *stream(): AsyncGenerator<AgentEvent> {
      if (options.fail) {
        yield { type: "error", error: options.fail }
        yield { type: "done", text: "", source: "agent", complete: false }
        return
      }
      yield { type: "text", text }
      yield {
        type: "done",
        text,
        source: "agent",
        complete: options.complete ?? true,
        model: "test/model",
        latencyMs: 1,
        usage: {
          agent_steps: 1,
          prompt_tokens: 10,
          completion_tokens: 5,
          cost_usd: null,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
        },
      }
    },
  }
}

describe("the classifier", () => {
  test("reads a rule number, named or bare", () => {
    assert.deepEqual(classify("what does rule 300.2.a say"), { intent: "RULE_N", ruleNumber: "300.2.a" })
    assert.deepEqual(classify("100.1"), { intent: "RULE_N", ruleNumber: "100.1" })
    assert.equal(classify("300.2.A?").ruleNumber, "300.2.a")
  })

  test("reads the whole banned list before it reads a card name", () => {
    // Checked first on purpose: otherwise "what is on the ban list" captures
    // "what" as a card name and answers about a card that does not exist.
    assert.equal(classify("what is on the ban list").intent, "BANLIST")
    assert.equal(classify("banlist").intent, "BANLIST")
    assert.equal(classify("what cards are banned").intent, "BANLIST")
  })

  test("reads a legality question and the card it names", () => {
    const c = classify("is Borrowed Hour banned")
    assert.equal(c.intent, "BANNED")
    assert.equal(c.cardKey, "borrowed hour")
  })

  test("survives an adverb between the name and the legality word", () => {
    // "Is X still banned?" captures "x still", which no index holds. Before the
    // key narrowing existed, that sent a banned card to a model to guess about.
    assert.equal(classify("is Borrowed Hour still banned").cardKey, "borrowed hour still")
    assert.equal(trimFiller("borrowed hour still"), "borrowed hour")
  })

  test("drops a trailing format rather than reading it as part of a name", () => {
    assert.equal(classify("is Borrowed Hour banned in standard").cardKey, "borrowed hour")
  })

  test("keeps a format word that is really part of a card name", () => {
    // The format list is closed for this reason. A wildcard after "in" would
    // cut "Trouble in Paradise" in half.
    assert.equal(classify("is Trouble in Paradise banned").cardKey, "trouble in paradise")
  })

  test("reads both cards when one sentence asks about two", () => {
    const c = classify("is Borrowed Hour banned or is Endless Reprise banned")
    assert.equal(c.intent, "BANNED")
    assert.match(c.cardKey ?? "", /borrowed hour/)
    assert.match(c.cardKey ?? "", /endless reprise/)
  })

  test("reads a legality question that also asks about the text", () => {
    const c = classify("can i play Lanternbearer and has its text been changed")
    assert.equal(c.intent, "BANNED")
    assert.equal(c.alsoErrata, true)
  })

  test("a clause of pure pronouns names no card", () => {
    assert.equal(trimErrataClause("has its text been changed"), "")
    assert.equal(trimErrataClause("has Fury Rune been reworked"), "fury rune")
  })

  test("returns NONE for a question no row can answer", () => {
    assert.equal(classify("how does blocking interact with Guard").intent, "NONE")
    assert.equal(classify("what is the best deck").intent, "NONE")
    assert.equal(classify("").intent, "NONE")
  })
})

describe("the glossary trigger", () => {
  test("reads a definition question", () => {
    assert.equal(definitionSubject("what is Guard"), "guard")
    assert.equal(definitionSubject("what does Swift mean?"), "swift")
    assert.equal(definitionSubject("define Bolster"), "bolster")
    assert.equal(definitionSubject("Fade"), "fade")
  })

  test("drops the article a reader puts in front of a term", () => {
    // The article belongs to the sentence, not to the term. Stripping only
    // "the" answered "what is the button" and refused "what is a kicker",
    // which reached the store as "a kicker" and matched nothing.
    assert.equal(definitionSubject("what is a kicker"), "kicker")
    assert.equal(definitionSubject("what is an ability"), "ability")
    assert.equal(definitionSubject("what is the button"), "button")
    assert.equal(definitionSubject("define a fork"), "fork")
  })

  test("drops the article in every phrasing, not only the first", () => {
    // The article was stripped in "what is a call" and not in "what does a
    // call mean", so one phrasing answered and the other went to the model.
    assert.equal(definitionSubject("what does a call mean"), "call")
    assert.equal(definitionSubject("what does the button do"), "button")
    assert.equal(definitionSubject("how does a raise work"), "raise")
  })

  test("reads a term of five words", () => {
    // Real vocabulary reaches this length: "one player to a hand" is a poker
    // rule. The cap guards against a whole question, and the store still
    // matches exactly, so a subject that is not a term simply finds nothing.
    assert.equal(definitionSubject("what is one player to a hand"), "one player to a hand")
    assert.equal(definitionSubject("what is the best way to win this whole game"), null)
  })

  test("keeps an article that is part of the term", () => {
    // "a" only goes when it is the leading word. A term that merely starts
    // with those letters must survive intact.
    assert.equal(definitionSubject("what is anteing"), "anteing")
    assert.equal(definitionSubject("what is theft"), "theft")
  })

  test("leaves a reasoning question alone", () => {
    // A question that merely mentions a keyword must fall through. The
    // definition alone answers it wrongly.
    assert.equal(definitionSubject("how does Guard interact with an unblockable unit"), null)
    assert.equal(definitionSubject("can I use Guard to block two attackers at once"), null)
  })
})

describe("caches", () => {
  test("holds a value until it expires", async () => {
    const cache = new MemoryCache()
    await cache.set("k", { text: "v" }, 60)
    assert.deepEqual(await cache.get("k"), { text: "v" })
    await cache.set("k", { text: "v" }, -1)
    assert.equal(await cache.get("k"), null)
  })

  test("bounds itself so a long-running process cannot run out of memory", async () => {
    const cache = new MemoryCache({ maxEntries: 3 })
    for (let i = 0; i < 10; i++) await cache.set(`k${i}`, i, 60)
    assert.equal(cache.size, 3)
    assert.equal(await cache.get("k0"), null)
    assert.equal(await cache.get("k9"), 9)
  })

  test("evicts the least recently read, not the oldest written", async () => {
    const cache = new MemoryCache({ maxEntries: 2 })
    await cache.set("a", 1, 60)
    await cache.set("b", 2, 60)
    await cache.get("a")
    await cache.set("c", 3, 60)
    assert.equal(await cache.get("a"), 1, "a was read most recently and must survive")
    assert.equal(await cache.get("b"), null)
  })

  test("survives a restart when it is on disk", async () => {
    const cache = await SqliteCache.open(":memory:")
    await cache.set("k", { text: "kept" }, 60)
    assert.deepEqual(await cache.get("k"), { text: "kept" })
    await cache.clear()
    assert.equal(await cache.get("k"), null)
    cache.close()
  })

  test("folds trivial question variants onto one key", () => {
    assert.equal(answerKey("Is X banned?"), answerKey("is  x   banned"))
    assert.notEqual(answerKey("is X banned"), answerKey("is Y banned"))
  })

  test("a version bump makes every old entry unreachable at once", () => {
    assert.notEqual(answerKey("q", "1"), answerKey("q", "2"))
  })
})

describe("the pipeline", () => {
  let store: RuleStore
  let profile: Profile

  before(async () => {
    const result = await loadCorpus(DEMO)
    assert.ok(result.ok)
    store = SqliteStore.fromCorpus(result.corpus)
    profile = parseProfile(JSON.parse(readFileSync(resolve(DEMO, "profile.json"), "utf8")))
  })

  const build = (stages: Stage[]) => createPipeline({ store, profile, stages, cache: new MemoryCache() })

  test("the first stage that can answer wins", async () => {
    const order: string[] = []
    const stage = (name: string, answer: Answer | null): Stage => ({
      name,
      async run() {
        order.push(name)
        return answer
      },
    })
    const answer: Answer = {
      text: "a",
      citations: [],
      source: "s",
      servedBy: "second",
      latencyMs: 0,
      model: null,
    }
    const result = await build([stage("first", null), stage("second", answer), stage("third", answer)]).run({
      question: "q",
    })
    assert.equal(result.answer?.servedBy, "second")
    assert.deepEqual(order, ["first", "second"])
  })

  test("a stage that throws degrades to a miss and the run continues", async () => {
    // Every stage before the last is an optimisation. A broken one must cost
    // latency and never the answer.
    const boom: Stage = {
      name: "boom",
      async run() {
        throw new Error("stage exploded")
      },
    }
    const result = await build([boom, agentStage(fakeAgent("the agent still answered"))]).run({
      question: "q",
    })
    assert.equal(result.answer?.text, "the agent still answered")
    assert.deepEqual(result.degraded, ["boom"])
    assert.deepEqual(result.answer?.degraded, ["boom"])
  })

  test("names the failed stage instead of swallowing it", async () => {
    // A silent catch makes a broken stage look exactly like a healthy one with
    // nothing to say, and that difference is the whole diagnosis.
    const result = await build([
      {
        name: "broken",
        async run() {
          throw new Error("x")
        },
      },
    ]).run({ question: "q" })
    assert.equal(result.answer, null)
    assert.deepEqual(result.degraded, ["broken"])
    assert.equal(result.trace.find((t) => t.stage === "broken")?.outcome, "failed")
  })

  test("skips a stage whose guard says not to run", async () => {
    const stage: Stage = {
      name: "skipped",
      when: () => false,
      async run() {
        throw new Error("must not run")
      },
    }
    const result = await build([stage]).run({ question: "q" })
    assert.equal(result.trace[0]?.outcome, "skipped")
  })

  test("reports the whole run's latency, not one stage's share", async () => {
    // THE BOUND IS LOOSE ON PURPOSE. A timer may fire a fraction of a
    // millisecond early, and the latency is counted from a clock that reports
    // whole milliseconds, so a sleep of exactly N can be measured as N minus
    // one. This asserted the sleep exactly and failed about one run in ten.
    // What the test is for is the gap between the stage that answered, which
    // takes no measurable time here, and the whole run.
    const slow: Stage = {
      name: "slow",
      async run() {
        await new Promise((r) => setTimeout(r, 30))
        return null
      },
    }
    const result = await build([slow, agentStage(fakeAgent("done"))]).run({ question: "q" })
    assert.ok(
      (result.answer?.latencyMs ?? 0) >= 20,
      `the answer reported ${result.answer?.latencyMs} ms, which cannot include a stage that slept 30`,
    )
  })

  test("answers a rule-number question from the rows, with no model", async () => {
    const pipeline = build([staticAnswersStage(store)])
    const result = await pipeline.run({ question: "what does rule 300.2.a say" })
    assert.equal(result.answer?.servedBy, "static")
    assert.match(result.answer?.text ?? "", /Rule 300\.2\.a/)
    assert.match(result.answer?.text ?? "", /Guard/)
  })

  test("answers a ban question from the rows, with its date", async () => {
    const result = await build([staticAnswersStage(store)]).run({ question: "is Borrowed Hour banned" })
    assert.equal(result.answer?.source, "banlist")
    assert.match(result.answer?.text ?? "", /banned/)
    assert.match(result.answer?.text ?? "", /2026-03-01/)
  })

  test("says a card is not on the list, and says what it checked", async () => {
    const result = await build([staticAnswersStage(store)]).run({ question: "is Lanternbearer banned" })
    assert.match(result.answer?.text ?? "", /not on the banned list/)
    assert.match(result.answer?.text ?? "", /Effective/, "a verdict with no date cannot be audited")
  })

  test("declines rather than calling an unknown name legal", async () => {
    // An unknown name may be misspelled, from another game, or nonexistent.
    // "Not banned" about it is a confident answer resting on nothing.
    const result = await build([staticAnswersStage(store)]).run({ question: "is Nonexistent Card banned" })
    assert.equal(result.answer, null)
  })

  test("names every printing when a reader asks about a shared name", async () => {
    // A reader who types a character name means every printing of it. Naming
    // one banned printing alone reads as a verdict on all of them.
    const result = await build([staticAnswersStage(store)]).run({ question: "is Stonewall Sentry banned" })
    const text = result.answer?.text ?? ""
    assert.match(text, /Stonewall Sentry/)
    assert.match(text, /printings/, "the other printings must be named, not summarised away")
  })

  test("links a card so the interface can preview it", async () => {
    const result = await build([staticAnswersStage(store)]).run({ question: "is Borrowed Hour banned" })
    assert.match(result.answer?.text ?? "", /\[Borrowed Hour\]\(card:paper-kingdoms\/PK-005\.webp\)/)
  })

  test("answers a definition question from the glossary, with no model", async () => {
    const result = await build([glossaryStage(store)]).run({ question: "what is Guard" })
    assert.equal(result.answer?.servedBy, "glossary")
    assert.match(result.answer?.text ?? "", /Guard/)
    assert.match(result.answer?.text ?? "", /rule 800\.1/)
  })

  test("lets a reasoning question through to the agent", async () => {
    const result = await build([
      glossaryStage(store),
      staticAnswersStage(store),
      agentStage(fakeAgent("a reasoned answer")),
    ]).run({ question: "how does Guard interact with an unblockable unit" })
    assert.equal(result.answer?.servedBy, "agent")
  })

  test("serves a repeat from the cache, without touching a later stage", async () => {
    const pipeline = build([exactCacheStage(), agentStage(fakeAgent("expensive answer"))])
    const first = await pipeline.run({ question: "a hard question" })
    assert.equal(first.answer?.servedBy, "agent")
    await writeBack(pipeline.contextFor({ question: "a hard question" }), first.answer as Answer)
    const second = await pipeline.run({ question: "A hard question?" })
    assert.equal(second.answer?.servedBy, "cache", "a folded repeat must hit the same entry")
    assert.equal(second.answer?.text, "expensive answer")
  })

  test("says where the version went, rather than ignoring one it is handed", () => {
    // The option moved to createPipeline. Ignoring it here would serve exactly
    // the stale answers the bump was meant to hide, and a caller writing plain
    // JavaScript gets no warning from a type.
    assert.throws(
      () => (exactCacheStage as (options: unknown) => Stage)({ version: "3" }),
      /cacheVersion/,
      "the message must name the replacement",
    )
    assert.doesNotThrow(() => exactCacheStage())
  })

  test("a bumped version reaches every writer, not only the reader", async () => {
    // Reads and writes must agree on the version. While only the reading stage
    // knew it, a bump emptied the cache for good rather than once: every answer
    // was written under the old version and looked for under the new one, so
    // nothing hit again and every question went to the model.
    const pipeline = createPipeline({
      store,
      profile,
      cache: new MemoryCache(),
      cacheVersion: "7",
      stages: [exactCacheStage(), agentStage(fakeAgent("expensive answer"))],
    })
    const first = await pipeline.run({ question: "a hard question" })
    assert.equal(first.answer?.servedBy, "agent")
    await writeBack(pipeline.contextFor({ question: "a hard question" }), first.answer as Answer)

    assert.ok(await pipeline.cache.get(answerKey("a hard question", "7")), "written under the new version")
    const second = await pipeline.run({ question: "a hard question" })
    assert.equal(second.answer?.servedBy, "cache")
  })

  test("a bumped version reaches the stages that write their own answers", async () => {
    const pipeline = createPipeline({
      store,
      profile,
      cache: new MemoryCache(),
      cacheVersion: "7",
      stages: [exactCacheStage(), staticAnswersStage(store), glossaryStage(store)],
    })
    const banned = await pipeline.run({ question: "is Borrowed Hour banned" })
    assert.equal(banned.answer?.servedBy, "static")
    const defined = await pipeline.run({ question: "what is Guard" })
    assert.equal(defined.answer?.servedBy, "glossary")

    assert.ok(await pipeline.cache.get(answerKey("is Borrowed Hour banned", "7")), "the static stage")
    assert.ok(await pipeline.cache.get(answerKey("what is Guard", "7")), "the glossary stage")
  })

  test("never caches a follow-up", async () => {
    // The same words mean different things after different questions. Caching
    // "shorter" would serve one reader's answer to the next.
    const pipeline = build([exactCacheStage(), agentStage(fakeAgent("shortened"))])
    const ctx = pipeline.contextFor({ question: "shorter", history: [{ role: "user", text: "earlier" }] })
    await writeBack(ctx, {
      text: "shortened",
      citations: [],
      source: "agent",
      servedBy: "agent",
      latencyMs: 0,
      model: null,
    })
    assert.equal(await pipeline.cache.get(answerKey("shorter")), null)
  })

  test("never caches an answer that was cut short", async () => {
    const pipeline = build([exactCacheStage()])
    const ctx = pipeline.contextFor({ question: "q" })
    await writeBack(ctx, {
      text: "half a sen",
      citations: [],
      source: "agent",
      servedBy: "agent",
      latencyMs: 0,
      model: null,
      complete: false,
    })
    assert.equal(await pipeline.cache.get(answerKey("q")), null)
  })

  test("skips the cache and the rows for a follow-up", async () => {
    const pipeline = build([
      exactCacheStage(),
      staticAnswersStage(store),
      agentStage(fakeAgent("follow-up answer")),
    ])
    const result = await pipeline.run({
      question: "is Borrowed Hour banned",
      history: [{ role: "user", text: "tell me about extra turns" }],
    })
    assert.equal(result.answer?.servedBy, "agent")
  })

  test("carries the agent's usage but not into the cache", async () => {
    const pipeline = build([exactCacheStage(), agentStage(fakeAgent("answer"))])
    const first = await pipeline.run({ question: "q" })
    assert.equal(first.answer?.usage?.prompt_tokens, 10)
    await writeBack(pipeline.contextFor({ question: "q" }), first.answer as Answer)
    const second = await pipeline.run({ question: "q" })
    assert.equal(second.answer?.usage, undefined, "a cache hit costs nothing and must report nothing")
  })

  test("an agent that fails leaves the run with no answer, not a bad one", async () => {
    const result = await build([agentStage(fakeAgent("", { fail: "provider is down" }))]).run({
      question: "q",
    })
    assert.equal(result.answer, null)
    assert.deepEqual(result.degraded, ["agent"])
  })

  test("a full pipeline routes each question to the cheapest stage that can answer", async () => {
    const pipeline = build([
      exactCacheStage(),
      staticAnswersStage(store),
      glossaryStage(store),
      agentStage(fakeAgent("reasoned")),
    ])
    const cases: [string, string][] = [
      ["what does rule 300.3 say", "static"],
      ["is Borrowed Hour banned", "static"],
      ["what is Swift", "glossary"],
      ["how do Guard and Swift interact when blocking", "agent"],
    ]
    for (const [question, expected] of cases) {
      const result = await pipeline.run({ question })
      assert.equal(result.answer?.servedBy, expected, `"${question}" should be served by ${expected}`)
    }
  })
})

describe("gates", () => {
  const ctx = {} as AskContext
  const answer = {} as Answer

  test("the shipped gate allows everything and records nothing", async () => {
    assert.deepEqual(await openGate.allow(ctx), { allow: true })
    await openGate.record(ctx, answer)
  })

  test("the first refusal wins", async () => {
    const no: Gate = {
      async allow() {
        return { allow: false, reason: "over quota", status: 429, retryAfterSeconds: 30 }
      },
      async record() {},
    }
    const verdict = await allGates(openGate, no, openGate).allow(ctx)
    assert.equal(verdict.allow, false)
    if (!verdict.allow) assert.equal(verdict.retryAfterSeconds, 30)
  })

  test("one gate that throws does not stop the others recording", async () => {
    let recorded = 0
    const boom: Gate = {
      async allow() {
        return { allow: true }
      },
      async record() {
        throw new Error("x")
      },
    }
    const counter: Gate = {
      async allow() {
        return { allow: true }
      },
      async record() {
        recorded++
      },
    }
    await allGates(boom, counter).record(ctx, answer)
    assert.equal(recorded, 1)
  })
})

describe("credentials", () => {
  test("reads a key from the environment", async () => {
    process.env.RULEKIT_TEST_KEY = "  from-env  "
    assert.equal(await fromEnv("RULEKIT_TEST_KEY").resolve(null), "from-env")
    delete process.env.RULEKIT_TEST_KEY
    assert.equal(await fromEnv("RULEKIT_TEST_KEY").resolve(null), null)
  })

  test("reads a key the caller supplied, which is the bring-your-own-key path", async () => {
    const request = new Request("https://example.test", { headers: { "x-model-key": "caller-key" } })
    assert.equal(await fromHeader().resolve(request), "caller-key")
  })

  test("takes the first resolver that offers one", async () => {
    process.env.RULEKIT_TEST_KEY = "env-key"
    const request = new Request("https://example.test", { headers: { "x-model-key": "caller-key" } })
    const resolver = firstOf(fromHeader(), fromEnv("RULEKIT_TEST_KEY"))
    assert.equal(await resolver.resolve(request), "caller-key")
    assert.equal(await resolver.resolve(null), "env-key")
    delete process.env.RULEKIT_TEST_KEY
  })
})

describe("a cache that stores nothing", () => {
  test("always misses, so a run measures its true cold cost", async () => {
    const cache = new NoopCache()
    await cache.set("k", 1, 60)
    assert.equal(await cache.get("k"), null)
  })
})
