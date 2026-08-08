import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadCorpus } from "@rulekit/corpus/load"
import { SqliteStore } from "@rulekit/corpus/sqlite-store"
import type { RuleStore } from "@rulekit/corpus/store"
import { decodeEvents, deriveLabel, encodeEvent } from "./events.ts"
import { buildInstructions } from "./instructions.ts"
import { minimalProfile, type Profile, parseProfile } from "./profile.ts"
import * as proseModule from "./prose.ts"
import { builtinSkills, findSkill } from "./skills.ts"
import { defineRulesTools, findTool, type RuleTool } from "./tools.ts"
import {
  AGENT_STEP_CAP,
  addStepUsage,
  buildMessage,
  EMPTY_USAGE,
  salvageAnswer,
  stepCapReached,
  usageOrNull,
} from "./turn.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
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
    // A run of unpriced calls must still reach the cap. Counting only priced
    // calls is how a loop runs past its ceiling without ever tripping it.
    let totals = EMPTY_USAGE
    for (let i = 0; i < AGENT_STEP_CAP; i++) totals = addStepUsage(totals, null)
    assert.equal(totals.agent_steps, AGENT_STEP_CAP)
    assert.equal(totals.cost_usd, null)
    assert.equal(stepCapReached(totals), true)
  })

  test("reads several spellings of the same field", () => {
    const a = addStepUsage(EMPTY_USAGE, { promptTokens: 5, completionTokens: 7 })
    assert.equal(a.prompt_tokens, 5)
    assert.equal(a.completion_tokens, 7)
    const b = addStepUsage(EMPTY_USAGE, { inputTokens: 5, outputTokens: 7 })
    assert.equal(b.prompt_tokens, 5)
    assert.equal(b.completion_tokens, 7)
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

  test("does not trip the cap early", () => {
    let totals = EMPTY_USAGE
    for (let i = 0; i < AGENT_STEP_CAP - 1; i++) totals = addStepUsage(totals, null)
    assert.equal(stepCapReached(totals), false)
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
    const { generate } = await import("../scripts/build-prose.mjs")
    const onDisk = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "prose.ts"), "utf8")
    assert.equal(
      onDisk,
      generate(),
      "src/prose.ts is out of date. Run `node scripts/build-prose.mjs` in packages/agent.",
    )
  })

  test("carries the grounding rules and the card procedure", () => {
    const { BASE_INSTRUCTIONS, SKILLS } = proseModule
    assert.match(BASE_INSTRUCTIONS, /Cite every claim/)
    assert.ok(SKILLS.some((s: { name: string }) => s.name === "card_lookup"))
  })
})
