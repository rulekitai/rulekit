#!/usr/bin/env node
// Prove the two runtimes are interchangeable.
//
//   node scripts/compare-runtimes.mjs "<question>"
//
// The whole reason two runtimes can exist is that both emit the same events, so
// one interface drives either. Nothing checked that. Both built, both declared
// the shared type, and neither had been run beside the other.
//
// This sends one question to each and compares the SEQUENCE OF EVENT TYPES and
// the shape of the terminal event. It does NOT compare the answers: two runs of
// one model differ, so demanding identical text would fail on a contract that
// is perfectly intact.
//
// The Eve half needs Node 24 and a running `eve dev`. Start it first:
//
//   cd templates/eve-agent && pnpm dev
//
// Without it, the AI SDK half still runs and this reports what it could not
// compare, rather than passing quietly.

import { readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { argv, env, exit, stdout } from "node:process"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const CORPUS = join(ROOT, env.RULEKIT_CORPUS ?? "data/riftbound")
const EVE_URL = env.EVE_URL ?? "http://127.0.0.1:2000"
const QUESTION = argv[2] ?? "how does Deflect interact with Shield when both are granted to the same unit"

const out = (line = "") => stdout.write(`${line}\n`)

/** The event types one run produced, in order, with repeats collapsed. */
function shape(events) {
  const types = events.map((e) => e.type)
  return types.filter((type, index) => type !== types[index - 1])
}

/** What the terminal event carries. Values differ per run; the KEYS must not. */
function doneShape(events) {
  const done = events.find((e) => e.type === "done")
  return done ? Object.keys(done).sort() : null
}

async function runAiSdk() {
  const { parseProfile } = await import("@rulekitai/agent/profile")
  const { createRulesAgent } = await import("@rulekitai/agent/runtime")
  const { SqliteStore } = await import("@rulekitai/corpus/sqlite-store")

  const store = SqliteStore.open(join(CORPUS, "corpus.db"))
  const profile = parseProfile(JSON.parse(readFileSync(join(CORPUS, "profile.json"), "utf8")))
  const agent = createRulesAgent({ store, profile, model: env.RULEKIT_MODEL ?? "anthropic/claude-sonnet-5" })

  const events = []
  for await (const event of agent.stream({ question: QUESTION })) events.push(event)
  await store.close()
  return events
}

async function runEve() {
  const { decodeEvents } = await import("@rulekitai/agent/events")
  const headers = { "content-type": "application/json" }
  if (env.RULEKIT_INTERNAL_SECRET) headers.authorization = `Bearer ${env.RULEKIT_INTERNAL_SECRET}`

  const res = await fetch(`${EVE_URL}/eve/v1/ask/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question: QUESTION }),
    signal: AbortSignal.timeout(300_000),
  })
  if (!res.ok) throw new Error(`the Eve agent answered ${res.status}`)
  if (!res.body) throw new Error("the Eve agent sent no body")

  const events = []
  for await (const event of decodeEvents(res.body)) events.push(event)
  return events
}

function report(name, events) {
  const done = events.find((e) => e.type === "done")
  out(`  ${name}`)
  out(`    events      ${events.length}`)
  out(`    sequence    ${shape(events).join(" → ")}`)
  out(`    done keys   ${(doneShape(events) ?? []).join(", ")}`)
  out(`    complete    ${done?.complete}`)
  out(`    answer      ${String(done?.text ?? "").length} characters`)
}

out(`Question: ${QUESTION}\n`)

const aiSdk = await runAiSdk()
report("AI SDK runtime", aiSdk)

let eve = null
try {
  eve = await runEve()
  out("")
  report("Eve template", eve)
} catch (error) {
  out("")
  out(`  Eve template: NOT COMPARED — ${error.message}`)
  out(`  Start it first: cd templates/eve-agent && pnpm dev   (needs Node 24)`)
}

out("")
if (!eve) {
  out("One runtime only. The contract is unproven until both run.")
  exit(2)
}

// The comparison. Types and keys, never text: two runs of one model differ, and
// demanding identical answers would fail on a contract that is intact.
const problems = []
const a = shape(aiSdk)
const b = shape(eve)
if (a.join(",") !== b.join(","))
  problems.push(`event sequence differs:\n    ai-sdk: ${a.join(" → ")}\n    eve:    ${b.join(" → ")}`)

const aKeys = doneShape(aiSdk)
const bKeys = doneShape(eve)
if (!aKeys || !bKeys) problems.push("a runtime produced no terminal event")
else if (aKeys.join(",") !== bKeys.join(","))
  problems.push(
    `done event carries different fields:\n    ai-sdk: ${aKeys.join(", ")}\n    eve:    ${bKeys.join(", ")}`,
  )

for (const events of [aiSdk, eve]) {
  const unknown = [...new Set(events.map((e) => e.type))].filter(
    (type) => !["step", "text", "done", "error"].includes(type),
  )
  if (unknown.length) problems.push(`a runtime emitted an event nothing reads: ${unknown.join(", ")}`)
}

if (problems.length) {
  out("MISMATCH. The two runtimes are not interchangeable:")
  for (const problem of problems) out(`  - ${problem}`)
  exit(1)
}

out("Both runtimes emit the same events, in the same order, with the same terminal shape.")
out("One interface drives either.")
