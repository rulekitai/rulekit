import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { loadCorpus } from "../corpus/load.ts"
import { SqliteStore } from "../corpus/sqlite-store.ts"
import type { RuleStore } from "../corpus/store.ts"
import type { Corpus } from "../corpus/types.ts"
import { decodeEvents, deriveLabel, encodeEvent } from "./events.ts"
import { buildInstructions } from "./instructions.ts"
import { minimalProfile, type Profile, parseProfile } from "./profile.ts"
import * as proseModule from "./prose.ts"
import { type AgentAnswer, resolveAnswer } from "./runtime.ts"
import { builtinSkills, findSkill } from "./skills.ts"
import {
  assertUniqueToolNames,
  corpusContents,
  defineRulesTools,
  defineTool,
  findTool,
  type RuleTool,
} from "./tools.ts"
import {
  addStepUsage,
  buildMessage,
  EMPTY_USAGE,
  SUGGESTED_STEP_CAP,
  salvageAnswer,
  stepCapReached,
  usageOrNull,
} from "./turn.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
const DEMO = resolve(ROOT, "data/demo")

/**
 * One tool's result.
 *
 * Every tool returns its own shape, so this is indexable rather than typed. The
 * index signature is `any` in effect but says so through the type rather than
 * through a keyword, which keeps the strict rules on everything else.
 */
type ToolResult = { [key: string]: ToolResult | ToolResult[] | string | number | boolean | null | undefined }

/** Call a tool without fighting its generic input type. */
const run = async (tool: RuleTool | undefined, input: unknown): Promise<ToolResult> => {
  assert.ok(tool, "tool is not registered")
  return tool.execute(input as never)
}

describe("turn accounting", () => {
  test("keeps null apart from zero", () => {
    const totals = addStepUsage(EMPTY_USAGE, { inputTokens: 10 })
    assert.equal(totals.prompt_tokens, 10)
    assert.equal(totals.completion_tokens, null, "a field nobody reported must stay null, not become 0")
    assert.equal(totals.agent_steps, 1)
  })

  test("counts a step the runtime priced at nothing", () => {
    // A run of unpriced calls must still reach a cap that was set. Counting
    // only priced calls is how a loop runs past its ceiling without tripping it.
    let totals = EMPTY_USAGE
    for (let i = 0; i < SUGGESTED_STEP_CAP; i++) totals = addStepUsage(totals, null)
    assert.equal(totals.agent_steps, SUGGESTED_STEP_CAP)
    assert.equal(totals.cost_usd, null)
    assert.equal(stepCapReached(totals, SUGGESTED_STEP_CAP), true)
  })

  test("never caps when no cap was set, which is the default", () => {
    // A cap is a cost control, and this project ships none. A turn ends when
    // the model stops calling tools.
    let totals = EMPTY_USAGE
    for (let i = 0; i < 500; i++) totals = addStepUsage(totals, null)
    assert.equal(stepCapReached(totals, null), false)
  })

  test("reads several spellings of the same field", () => {
    const a = addStepUsage(EMPTY_USAGE, { promptTokens: 5, completionTokens: 7 })
    assert.equal(a.prompt_tokens, 5)
    assert.equal(a.completion_tokens, 7)
    const b = addStepUsage(EMPTY_USAGE, { inputTokens: 5, outputTokens: 7 })
    assert.equal(b.prompt_tokens, 5)
    assert.equal(b.completion_tokens, 7)
  })

  test("reads a price a gateway reported, as the string it sends", () => {
    // No price table ships here, and none should. But a gateway that already
    // priced the call says so, and it says so as a string beside the tokens.
    const totals = addStepUsage(EMPTY_USAGE, { inputTokens: 10 }, { gateway: { cost: "0.00093" } })
    assert.equal(totals.cost_usd, 0.00093)
  })

  test("sums a price across steps", () => {
    let totals = addStepUsage(EMPTY_USAGE, null, { gateway: { cost: "0.001" } })
    totals = addStepUsage(totals, null, { gateway: { cost: "0.002" } })
    assert.ok(Math.abs((totals.cost_usd ?? 0) - 0.003) < 1e-9)
  })

  test("leaves the price null when no provider reported one", () => {
    // Null is not zero. A zero reads as a genuinely free answer and drags a
    // measured average down; a null is simply omitted.
    assert.equal(addStepUsage(EMPTY_USAGE, { inputTokens: 10 }).cost_usd, null)
    assert.equal(addStepUsage(EMPTY_USAGE, null, { anthropic: {} }).cost_usd, null)
  })

  test("ignores a price that is not a number", () => {
    assert.equal(addStepUsage(EMPTY_USAGE, null, { gateway: { cost: "unknown" } }).cost_usd, null)
  })

  test("sums across steps", () => {
    const totals = addStepUsage(addStepUsage(EMPTY_USAGE, { inputTokens: 10 }), { inputTokens: 4 })
    assert.equal(totals.prompt_tokens, 14)
    assert.equal(totals.agent_steps, 2)
  })

  test("reports no usage for a turn that measured nothing", () => {
    assert.equal(usageOrNull(EMPTY_USAGE), null)
    assert.ok(usageOrNull(addStepUsage(EMPTY_USAGE, null)))
  })

  test("does not trip a set cap early", () => {
    let totals = EMPTY_USAGE
    for (let i = 0; i < SUGGESTED_STEP_CAP - 1; i++) totals = addStepUsage(totals, null)
    assert.equal(stepCapReached(totals, SUGGESTED_STEP_CAP), false)
  })

  test("keeps text a stream produced without a terminal event", () => {
    const salvaged = salvageAnswer("", "half an answer")
    assert.equal(salvaged.text, "half an answer")
    assert.equal(salvaged.complete, false, "salvaged text must never be cached")
  })

  test("prefers the terminal text when there is one", () => {
    assert.deepEqual(salvageAnswer("done", "partial"), { text: "done", complete: true })
  })
})

describe("building the message", () => {
  test("sends a first question on its own", () => {
    assert.equal(buildMessage("what is Guard"), "what is Guard")
  })

  test("carries the conversation so a follow-up has context", () => {
    const message = buildMessage("shorter", [
      { role: "user", text: "what is Guard" },
      { role: "assistant", text: "Guard means ..." },
    ])
    assert.match(message, /User: what is Guard/)
    assert.match(message, /Assistant: Guard means/)
    assert.match(message, /User: shorter$/)
  })

  test("drops empty turns rather than sending blank lines", () => {
    const message = buildMessage("next", [
      { role: "user", text: "   " },
      { role: "assistant", text: "real" },
    ])
    assert.ok(!message.includes("User: \n"))
    assert.match(message, /Assistant: real/)
  })

  test("hands over rules an earlier stage already found", () => {
    const message = buildMessage("q", [], [{ rule_number: "300.2", content: "Blocking works like this." }])
    assert.match(message, /\[300\.2\]: Blocking works like this\./)
    assert.match(message, /already found these rules/)
  })

  test("ignores a retrieved rule with no text", () => {
    assert.equal(buildMessage("q", [], [{ rule_number: "1", content: "" }]), "q")
  })
})

describe("what a finished turn returns", () => {
  const answer = (text: string): AgentAnswer => ({
    text,
    complete: true,
    steps: [],
    usage: null,
    model: null,
    latencyMs: 0,
  })

  test("a failure that wrote nothing throws rather than returning a blank", () => {
    // The stream reports the error and still ends with a terminal event, so
    // the blank would otherwise be returned as a successful empty answer. A
    // caller grading answers scores a blank as clean, because it cites nothing
    // and quotes nothing: an outage would read as a perfect score.
    assert.throws(() => resolveAnswer(answer(""), "budget exceeded"), /budget exceeded/)
  })

  test("a failure that wrote something returns what it wrote", () => {
    assert.equal(resolveAnswer(answer("half an answer"), "connection lost").text, "half an answer")
  })

  test("an empty answer with no error is still an answer", () => {
    // A model may legitimately end a turn having written nothing, and that is
    // not the same event as a provider failing.
    assert.equal(resolveAnswer(answer(""), null).text, "")
  })

  test("no terminal event at all throws", () => {
    assert.throws(() => resolveAnswer(null, null), /without an answer/)
  })
})

describe("events", () => {
  test("round-trips through NDJSON", async () => {
    const events = [
      {
        type: "step" as const,
        step: {
          id: "1",
          tool: "search_all",
          label: "Searched",
          kind: "searched" as const,
          status: "running" as const,
        },
      },
      { type: "text" as const, text: "hello" },
      { type: "done" as const, text: "hello", source: "agent", complete: true },
    ]
    const body = new Blob([events.map(encodeEvent).join("")]).stream()
    const decoded = []
    for await (const event of decodeEvents(body)) decoded.push(event)
    assert.deepEqual(decoded, events)
  })

  test("survives a chunk boundary inside one line", async () => {
    const line = encodeEvent({ type: "text", text: "a long answer" })
    const split = Math.floor(line.length / 2)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder()
        controller.enqueue(encoder.encode(line.slice(0, split)))
        controller.enqueue(encoder.encode(line.slice(split)))
        controller.close()
      },
    })
    const decoded = []
    for await (const event of decodeEvents(stream)) decoded.push(event)
    assert.deepEqual(decoded, [{ type: "text", text: "a long answer" }])
  })

  test("skips one corrupt line instead of ending the turn", async () => {
    const body = new Blob([`{not json\n${encodeEvent({ type: "text", text: "kept" })}`]).stream()
    const decoded = []
    for await (const event of decodeEvents(body)) decoded.push(event)
    assert.deepEqual(decoded, [{ type: "text", text: "kept" }])
  })

  test("labels a tool call in plain words", () => {
    assert.deepEqual(deriveLabel("search_cards", { query: "Lanternbearer" }), {
      label: "Searched cards: Lanternbearer",
      kind: "searched",
    })
    assert.equal(deriveLabel("get_cards").kind, "looked-up")
    assert.equal(deriveLabel("something_new").label, "something new")
  })
})

describe("profile and instructions", () => {
  const demoProfile = parseProfile(JSON.parse(readFileSync(resolve(DEMO, "profile.json"), "utf8")))

  test("describes a printed value the name does not explain", () => {
    // A stat reaches the model as a bare name and a number. `price: 70` names
    // no currency and `rank_value: 14` names no scale, so a profile can say
    // what those mean rather than leave the model to guess.
    const profile = parseProfile({
      game: { name: "G" },
      cards: {
        enabled: true,
        statFields: [{ field: "price", describes: "What the Bank charges, in Crowns." }],
      },
    })
    const text = buildInstructions(profile)
    assert.match(text, /`price` — What the Bank charges, in Crowns\./)
  })

  test("says nothing about values when a game describes none", () => {
    // The section costs prompt on every card question, so an undescribed game
    // must not pay for an empty heading.
    const profile = parseProfile({ game: { name: "G" }, cards: { enabled: true } })
    assert.ok(!buildInstructions(profile).includes("A card also prints values"))
  })

  test("reads the demo profile", () => {
    assert.equal(demoProfile.game.name, "Paper Kingdoms")
    assert.equal(demoProfile.cards.enabled, true)
    assert.equal(demoProfile.cards.maxInlineImages, 2)
  })

  test("refuses a profile that names no game", () => {
    assert.throws(() => parseProfile({ game: {} }))
  })

  test("a one-line profile still builds instructions", () => {
    const text = buildInstructions(minimalProfile("Some Game"))
    assert.match(text, /You are a Some Game rules assistant/)
    assert.match(text, /Cite every claim/)
  })

  test("always includes the grounding rules, whatever the profile says", () => {
    // A profile may sharpen a rule. It must not be able to remove one.
    const text = buildInstructions(demoProfile)
    for (const required of [
      "Cite every claim",
      "Do not invent",
      "Quote, do not restate",
      "You are unofficial",
    ]) {
      assert.match(text, new RegExp(required))
    }
  })

  test("renders the game's own vocabulary", () => {
    const text = buildInstructions(demoProfile)
    assert.match(text, /Say \*\*"Resolve"\*\*/)
    assert.match(text, /Never say "toughness"/)
  })

  test("leaves the card section out when a corpus has no cards", () => {
    const text = buildInstructions(minimalProfile("Board Game"))
    assert.ok(!text.includes("# Cards"))
    assert.ok(!text.includes("card:"))
  })

  test("leaves the symbol section out when a game has no symbols", () => {
    assert.ok(!buildInstructions(demoProfile).includes("# Symbols"))
  })

  test("renders symbols when a game has them", () => {
    const withTokens = parseProfile({
      game: { name: "Tokened" },
      tokens: { syntax: "[Fury]", groups: [{ label: "Runes", examples: ["[Fury]", "[Calm]"] }] },
    })
    const text = buildInstructions(withTokens)
    assert.match(text, /# Symbols/)
    assert.match(text, /`\[Fury\]`/)
  })

  test("inlines a procedure when asked to", () => {
    const text = buildInstructions(demoProfile, { skills: builtinSkills() })
    assert.match(text, /# Procedures/)
    assert.match(text, /Reading a card/)
  })
})

describe("skills", () => {
  test("parses front matter into a description the model can match on", () => {
    const skill = findSkill("card_lookup")
    assert.ok(skill)
    assert.match(skill.description, /card/)
    assert.ok(!skill.body.startsWith("---"), "front matter must not reach the prompt")
    assert.match(skill.body, /search_cards/)
  })
})

describe("tools over the demo corpus", () => {
  let store: RuleStore
  let tools: RuleTool[]
  let profile: Profile

  before(async () => {
    const result = await loadCorpus(DEMO)
    assert.ok(result.ok)
    store = SqliteStore.fromCorpus(result.corpus)
    profile = parseProfile(JSON.parse(readFileSync(resolve(DEMO, "profile.json"), "utf8")))
    tools = defineRulesTools(store, profile)
  })

  test("registers every tool with a name, a description, and a schema", () => {
    assert.ok(tools.length >= 12)
    for (const tool of tools) {
      assert.match(tool.name, /^[a-z_]+$/)
      assert.ok(tool.description.length > 40, `${tool.name} needs a description the model can choose by`)
      assert.ok(tool.inputSchema)
    }
  })

  test("no tool name repeats", () => {
    assert.equal(new Set(tools.map((t) => t.name)).size, tools.length)
  })

  test("every built-in name passes the pattern Eve enforces", () => {
    // Eve names a tool after its file. A name outside this pattern ships fine
    // on the AI SDK and stops `pnpm eve build` for anybody using the template.
    for (const tool of tools) assert.match(tool.name, /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/)
  })

  test("search_all reaches rules, terms, and the banned list at once", async () => {
    const found = await run(findTool(tools, "search_all"), { query: "Borrowed Hour" })
    assert.ok(found.banlist.length > 0)
    assert.ok(found.errata.length > 0)
  })

  test("get_rule reads a rule by number", async () => {
    const found = await run(findTool(tools, "get_rule"), { rule_number: "300.2.a" })
    assert.equal(found.rule.rule_number, "300.2.a")
    assert.match(found.rule.content, /Guard/)
  })

  test("get_rule says so plainly when there is no such rule", async () => {
    const found = await run(findTool(tools, "get_rule"), { rule_number: "999.9" })
    assert.equal(found.rule, null)
    assert.match(found.error, /No rule/)
  })

  test("get_rule_context returns the whole neighbourhood in one call", async () => {
    const found = await run(findTool(tools, "get_rule_context"), { rule_id: "r-300-2" })
    assert.equal(found.rule.rule_number, "300.2")
    assert.deepEqual(
      found.children.map((c: { rule_number: string }) => c.rule_number),
      ["300.2.a"],
    )
    assert.deepEqual(found.related.map((c: { rule_number: string }) => c.rule_number).sort(), [
      "300.3",
      "800.1",
    ])
  })

  test("search_terms answers a definition question in one call", async () => {
    const found = await run(findTool(tools, "search_terms"), { query: "Guard" })
    assert.equal(found.terms[0].term, "Guard")
    assert.equal(found.terms[0].defining_rule_number, "800.1")
  })

  test("list_banlist reports the entry type and its date", async () => {
    const found = await run(findTool(tools, "list_banlist"), { card_name: "Borrowed Hour" })
    assert.equal(found.count, 1)
    assert.equal(found.entries[0].entry_type, "banned")
    assert.equal(found.entries[0].effective_date, "2026-03-01")
  })

  test("list_banlist returns an empty list rather than an error for a legal card", async () => {
    // The absence of a row is an answer. Returning an error here is what makes a
    // model reach for memory instead of reporting what it read.
    const found = await run(findTool(tools, "list_banlist"), { card_name: "Lanternbearer" })
    assert.equal(found.count, 0)
    assert.deepEqual(found.entries, [])
  })

  test("get_cards sends no empty fields", async () => {
    // A card record has seventeen fields and no game fills them all. Sending
    // the empty ones costs tokens on every call and invites the model to
    // narrate an internal field name to a reader who has never heard of it.
    const found = await run(findTool(tools, "get_cards"), { ids: ["pk-005"] })
    const card = found.cards[0] as Record<string, unknown>
    assert.ok("card_text" in card, "a field it carries is present")
    assert.ok(!("might" in card), "a field it does not carry is absent, not null")
    for (const value of Object.values(card)) {
      assert.ok(value !== null && value !== "", "no empty value reaches the model")
    }
  })

  test("get_cards keeps every text box", async () => {
    const found = await run(findTool(tools, "get_cards"), { ids: ["pk-006"] })
    assert.equal(found.cards[0].card_text, "Equip 2.")
    assert.equal(found.cards[0].effect_text, "The equipped unit has Guard.")
  })

  test("get_cards names the ids that matched nothing", async () => {
    const found = await run(findTool(tools, "get_cards"), { ids: ["pk-001", "not-a-card"] })
    assert.deepEqual(found.missing, ["not-a-card"])
  })

  test("search_cards returns identity without card text", async () => {
    const found = await run(findTool(tools, "search_cards"), { query: "Stonewall Sentry" })
    assert.equal(found.matches[0].id, "pk-001")
    assert.ok(!("card_text" in found.matches[0]), "search must not carry text, so the model fetches it")
  })

  test("list_patch_notes leaves bodies out of the list and returns one in full", async () => {
    const list = await run(findTool(tools, "list_patch_notes"), {})
    assert.ok(list.notes.every((n: Record<string, unknown>) => !("body" in n)))
    const one = await run(findTool(tools, "list_patch_notes"), { slug: "v1-2-rules-update" })
    assert.match(one.note.body, /Starting life moves from 20 to 25/)
  })

  test("bounds a result a model would otherwise pay for on every later step", async () => {
    const found = await run(findTool(tools, "search_rules"), { query: "rule", limit: 20 })
    assert.ok(found.rules.length <= 20)
    for (const rule of found.rules) assert.ok(rule.content.length <= 2000)
  })

  test("leaves card tools out when a corpus has no cards", () => {
    const noCards = defineRulesTools(store, minimalProfile("No Cards"))
    assert.equal(findTool(noCards, "search_cards"), undefined)
    assert.equal(findTool(noCards, "get_cards"), undefined)
    assert.ok(findTool(noCards, "search_all"))
  })

  test("every tool input schema rejects a wrong shape", () => {
    const search = findTool(tools, "search_all")
    assert.ok(search)
    assert.equal(search.inputSchema.safeParse({ query: "" }).success, false)
    assert.equal(search.inputSchema.safeParse({ query: "ok" }).success, true)
  })

  test("get_rule demands one of its two ways to name a rule", () => {
    const tool = findTool(tools, "get_rule")
    assert.ok(tool)
    assert.equal(tool.inputSchema.safeParse({}).success, false)
    assert.equal(tool.inputSchema.safeParse({ rule_number: "100.1" }).success, true)
  })
})

describe("the generated prose module", () => {
  test("matches the Markdown it was generated from", async () => {
    // The instructions and skills are authored as Markdown and compiled into a
    // module, because reading them from disk at run time fails inside a bundle.
    // A generated file that is checked in can go stale, so this is the check
    // that turns a forgotten regeneration into a failing test rather than an
    // assistant quietly running last month's instructions.
    const { generate } = await import("../../scripts/build-prose.mjs")
    const onDisk = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "prose.ts"), "utf8")
    assert.equal(
      onDisk,
      generate(),
      "src/prose.ts is out of date. Run `node scripts/build-prose.mjs` in packages/rulekit.",
    )
  })

  test("carries the grounding rules and the card procedure", () => {
    const { BASE_INSTRUCTIONS, SKILLS } = proseModule
    assert.match(BASE_INSTRUCTIONS, /Cite every claim/)
    assert.ok(SKILLS.some((s: { name: string }) => s.name === "card_lookup"))
  })
})

describe("tools describe the game they serve", () => {
  const chessLike = (noun: string) =>
    parseProfile({ game: { name: "Chess" }, cards: { enabled: true, noun } })

  test("calls a piece what the game calls it", () => {
    // "card" is a trading card game's word. A chess assistant offered a tool
    // for "Chess cards" is being told its game has cards.
    const store = SqliteStore.fromCorpus(EMPTY_CORPUS)
    const search = findTool(defineRulesTools(store, chessLike("piece")), "search_cards")
    assert.match(search?.description ?? "", /Chess pieces/)
    assert.ok(!/Chess cards/.test(search?.description ?? ""))
  })

  test("keeps the word card for a game that uses it", () => {
    const store = SqliteStore.fromCorpus(EMPTY_CORPUS)
    const search = findTool(defineRulesTools(store, chessLike("card")), "search_cards")
    assert.match(search?.description ?? "", /Chess cards/)
  })

  test("offers no tool for a collection the corpus does not hold", async () => {
    // A tool that can only answer "nothing found" costs a step and teaches the
    // model that these tools return nothing.
    const store = SqliteStore.fromCorpus(EMPTY_CORPUS)
    const contents = await corpusContents(store)
    assert.deepEqual(contents, { errata: false, banlist: false, patchNotes: false, rulings: false })
    const names = defineRulesTools(store, chessLike("piece"), contents).map((t) => t.name)
    assert.ok(!names.includes("list_banlist"))
    assert.ok(!names.includes("list_errata"))
    assert.ok(!names.includes("list_patch_notes"))
    assert.ok(!names.includes("list_rulings"))
    assert.ok(names.includes("search_rules"), "the rule tools must stay")
  })

  test("offers no rulings tool to a store that predates rulings", async () => {
    // A store written against an earlier version of the interface has no
    // `listRulings`. That reads as "this corpus holds none" rather than
    // throwing, which is what keeps an older custom store working.
    const store = SqliteStore.fromCorpus(EMPTY_CORPUS)
    // A Proxy rather than a spread: the store's reads live on its prototype, so
    // spreading it copies none of them and would test an empty object instead.
    const older = new Proxy(store, {
      get: (target, key) =>
        key === "listRulings" || key === "searchRulings"
          ? undefined
          : Reflect.get(target, key).bind?.(target),
    }) as unknown as RuleStore
    const contents = await corpusContents(older)
    assert.equal(contents.rulings, false)
    assert.ok(
      !defineRulesTools(older, chessLike("piece"), contents)
        .map((t) => t.name)
        .includes("list_rulings"),
    )
  })

  test("offers the rulings tool only when the corpus holds a ruling", async () => {
    const store = SqliteStore.fromCorpus({
      ...EMPTY_CORPUS,
      rulings: [
        {
          id: "g1",
          kind: "card",
          question: "Does it?",
          answer: "Yes.",
          cards: [],
          rule_numbers: [],
          topic: null,
          source_name: null,
          source_url: null,
          is_official: false,
          effective_date: null,
          is_deprecated: false,
          deprecation_note: null,
        },
      ],
    })
    const contents = await corpusContents(store)
    assert.equal(contents.rulings, true)
    const names = defineRulesTools(store, chessLike("piece"), contents).map((t) => t.name)
    assert.ok(names.includes("list_rulings"))
  })

  test("offers them when the corpus does hold them", async () => {
    const store = SqliteStore.fromCorpus({
      ...EMPTY_CORPUS,
      banlist: [
        {
          id: "b1",
          card: null,
          format: null,
          entry_type: "banned",
          effective_date: "2026-01-01",
          reason: null,
          patch_note_slug: null,
          patch_note_title: null,
        },
      ],
    })
    const names = defineRulesTools(store, chessLike("card"), await corpusContents(store)).map((t) => t.name)
    assert.ok(names.includes("list_banlist"))
  })
})

const EMPTY_CORPUS: Corpus = {
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

/**
 * Adding a tool of your own.
 *
 * These three guards exist because the failure they stop is silent. A repeated
 * name removed a built-in and reported nothing, and a hand-written input
 * annotation could disagree with its schema forever.
 */
describe("defining a tool", () => {
  const spec = {
    name: "check_stock",
    description: "Read how many copies of a card a shop holds.",
    inputSchema: z.object({ sku: z.string(), limit: z.number().optional() }),
    execute: async (input: { sku: string; limit?: number }) => ({ sku: input.sku }),
  }

  test("returns a tool the runtime can use", async () => {
    const tool = defineTool(spec)
    assert.equal(tool.name, "check_stock")
    assert.ok(tool.inputSchema)
    assert.deepEqual(await tool.execute({ sku: "abc" } as never), { sku: "abc" })
  })

  test("refuses a name Eve would reject", () => {
    // Eve names a tool after its file, and its pattern is the strictest one in
    // the project. A name that fails it stops `pnpm eve build`.
    assert.throws(() => defineTool({ ...spec, name: "9lives" }), /not a usable tool name/)
    assert.throws(() => defineTool({ ...spec, name: "has spaces" }), /not a usable tool name/)
    assert.throws(() => defineTool({ ...spec, name: "" }), /not a usable tool name/)
    assert.throws(() => defineTool({ ...spec, name: `a${"b".repeat(64)}` }), /not a usable tool name/)
  })

  test("accepts a name at the 64-character limit", () => {
    assert.equal(defineTool({ ...spec, name: `a${"b".repeat(63)}` }).name.length, 64)
  })

  test("keeps describeResult and replaces off unless they are set", () => {
    const plain = defineTool(spec)
    assert.equal(plain.describeResult, undefined)
    assert.equal(plain.replaces, undefined)
    assert.equal(defineTool({ ...spec, replaces: true }).replaces, true)
  })
})

describe("two tools of one name", () => {
  const tool = (name: string, replaces?: boolean) =>
    defineTool({
      name,
      description: "d",
      inputSchema: z.object({}),
      execute: async () => ({}),
      ...(replaces ? { replaces: true } : {}),
    })

  test("throws, and names the tool", () => {
    // The runtime builds its map with Object.fromEntries, which keeps the LAST
    // entry. Before this guard, a custom `get_rule` removed the built-in one and
    // the only symptom was a worse answer.
    assert.throws(
      () => assertUniqueToolNames([tool("get_rule"), tool("get_rule")]),
      /Two tools are named "get_rule"/,
    )
  })

  test("tells the reader both ways forward", () => {
    assert.throws(() => assertUniqueToolNames([tool("a"), tool("a")]), /Rename your tool.*replaces: true/s)
  })

  test("allows a replacement that says so", () => {
    assert.doesNotThrow(() => assertUniqueToolNames([tool("search_all"), tool("search_all", true)]))
  })

  test("passes a list with no repeat", () => {
    assert.doesNotThrow(() => assertUniqueToolNames([tool("a"), tool("b"), tool("c")]))
  })
})

describe("a procedure whose tool is absent", () => {
  const skill = (name: string, requiresTool?: string) => ({
    name,
    description: "d",
    body: "b",
    ...(requiresTool ? { requiresTool } : {}),
  })
  /** The filter `createRulesAgent` applies, isolated so a test needs no model. */
  const keep = (skills: ReturnType<typeof skill>[], names: string[]) =>
    skills.filter((s) => !s.requiresTool || new Set(names).has(s.requiresTool)).map((s) => s.name)

  test("drops the procedure, and keeps one that needs nothing", () => {
    assert.deepEqual(keep([skill("rulings_lookup", "list_rulings"), skill("sequence")], ["search_all"]), [
      "sequence",
    ])
  })

  test("keeps the procedure when its tool exists", () => {
    assert.deepEqual(keep([skill("card_lookup", "search_cards")], ["search_cards"]), ["card_lookup"])
  })

  test("the shipped procedures name the tool each one needs", () => {
    // The gate used to be a hard-coded list of two names in runtime.ts. Each
    // procedure now states its own requirement, so a caller's procedure can too.
    assert.equal(findSkill("card_lookup")?.requiresTool, "search_cards")
    assert.equal(findSkill("rulings_lookup")?.requiresTool, "list_rulings")
    assert.equal(findSkill("sequence")?.requiresTool, undefined)
    assert.equal(findSkill("interaction")?.requiresTool, undefined)
  })
})
