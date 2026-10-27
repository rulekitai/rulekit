import assert from "node:assert/strict"
import test from "node:test"
import channel from "../agent/channels/ask.ts"

const handler = channel.routes[0].handler

async function ask(events) {
  const request = new Request("http://test/ask/stream", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question: "What is the rule?" }),
  })
  const response = await handler(request, {
    from: () => ({
      send: async () => ({
        async *stream() {
          yield* events
        },
      }),
    }),
  })
  return (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
}

test("translates v27 tool calls, narration, replies and all usage through the ask route", async () => {
  const events = await ask([
    { type: "model.requested", data: { runId: "a", owner: { turnId: "t" } } },
    { type: "content.delta", data: { partId: "p", kind: "text", delta: "Looking" } },
    { type: "content.completed", data: { partId: "p", kind: "text", phase: "narration", value: "Looking" } },
    {
      type: "call.requested",
      data: { callId: "c", capability: { kind: "tool", name: "get_rule" }, input: { rule_number: "1.1" } },
    },
    { type: "call.settled", data: { callId: "c", outcome: "completed" } },
    { type: "model.settled", data: { runId: "a", outcome: "completed", finishReason: "tool-calls" } },
    {
      type: "usage.recorded",
      data: { usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 } },
    },
    { type: "model.requested", data: { runId: "b", owner: { turnId: "t" } } },
    { type: "content.delta", data: { partId: "q", kind: "reasoning", delta: "private" } },
    { type: "content.delta", data: { partId: "r", kind: "text", delta: "Rule" } },
    { type: "content.delta", data: { partId: "r", delta: " 1.1" } },
    { type: "content.completed", data: { partId: "r", kind: "text", phase: "reply", value: "Rule 1.1" } },
    { type: "model.settled", data: { runId: "b", outcome: "completed", finishReason: "stop" } },
    {
      type: "usage.recorded",
      data: {
        usage: { inputTokens: 20, outputTokens: 4, cacheReadTokens: 5, cacheWriteTokens: 2, costUsd: 0.02 },
      },
    },
    { type: "turn.settled", data: { outcome: "completed" } },
  ])
  assert.deepEqual(
    events.filter((e) => e.type === "step").map((e) => e.step.status),
    ["running", "completed"],
  )
  assert.ok(!events.some((e) => e.text?.includes("private")))
  assert.ok(events.some((e) => e.type === "text" && e.text === ""))
  assert.equal(events.at(-1).text, "Rule 1.1")
  assert.equal(events.at(-1).complete, true)
  assert.deepEqual(events.at(-1).usage, {
    prompt_tokens: 30,
    completion_tokens: 6,
    cache_read_input_tokens: 8,
    cache_creation_input_tokens: 3,
    cost_usd: 0.02,
    agent_steps: 2,
  })
})

test("reports a failed turn without marking partial text complete", async () => {
  const events = await ask([
    { type: "content.delta", data: { partId: "p", kind: "text", delta: "Partial" } },
    { type: "turn.settled", data: { outcome: "failed", error: { message: "model failed" } } },
  ])
  assert.ok(events.some((e) => e.type === "error" && e.error === "model failed"))
  assert.equal(events.at(-1).text, "Partial")
  assert.equal(events.at(-1).complete, false)
})

test("does not mark a reply complete before the turn settles", async () => {
  const events = await ask([
    { type: "content.completed", data: { partId: "p", kind: "text", phase: "reply", value: "Partial" } },
  ])
  assert.equal(events.at(-1).text, "Partial")
  assert.equal(events.at(-1).complete, false)
})

test("joins the text parts named by the completed turn", async () => {
  const events = await ask([
    { type: "content.completed", data: { partId: "p", kind: "text", phase: "reply", value: "First. " } },
    { type: "content.completed", data: { partId: "q", kind: "text", phase: "reply", value: "Second." } },
    { type: "turn.settled", data: { outcome: "completed", reply: ["p", "q"] } },
  ])
  assert.equal(events.at(-1).text, "First. Second.")
  assert.equal(events.at(-1).complete, true)
})
