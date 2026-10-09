import assert from "node:assert/strict"
import test from "node:test"
import { EMPTY_USAGE, usageOrNull } from "@rulekitai/rulekit/agent/turn"
import { addEveStepUsage, withEveSessionUsage } from "./stream-usage.ts"

test("retains Eve cache reads, cache writes, and unpriced model calls", () => {
  const usage = addEveStepUsage(EMPTY_USAGE, { cacheReadTokens: 12, cacheWriteTokens: 4 })
  assert.equal(usage.cache_read_input_tokens, 12)
  assert.equal(usage.cache_creation_input_tokens, 4)
  assert.equal(usage.cost_usd, null)
  assert.equal(addEveStepUsage(usage, undefined).agent_steps, 2)
})

test("includes compaction in session totals without counting another agent step", () => {
  const usage = addEveStepUsage(EMPTY_USAGE, { inputTokens: 10, outputTokens: 5, costUsd: 0.01 })
  assert.deepEqual(
    withEveSessionUsage(usage, {
      inputTokens: 15,
      outputTokens: 8,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      costUsd: 0.02,
    }),
    {
      prompt_tokens: 15,
      completion_tokens: 8,
      cache_read_input_tokens: 2,
      cache_creation_input_tokens: 1,
      cost_usd: 0.02,
      agent_steps: 1,
    },
  )
  assert.equal(withEveSessionUsage(usage, undefined), usage)
})

test("reports compaction spend even when the first agent model call fails", () => {
  const usage = withEveSessionUsage(EMPTY_USAGE, {
    inputTokens: 15,
    outputTokens: 8,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.02,
  })
  assert.equal(usage.agent_steps, 0)
  assert.equal(usageOrNull(usage)?.cost_usd, 0.02)
})
