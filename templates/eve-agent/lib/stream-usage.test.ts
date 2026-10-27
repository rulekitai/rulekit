import assert from "node:assert/strict"
import test from "node:test"
import { EMPTY_USAGE, usageOrNull } from "@rulekitai/rulekit/agent/turn"
import { addEveUsage } from "./stream-usage.ts"

test("adds model and compaction spend without counting extra model calls", () => {
  const one = addEveUsage(
    { ...EMPTY_USAGE, agent_steps: 1 },
    {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 12,
      cacheWriteTokens: 4,
      costUsd: 0.01,
    },
  )
  const total = addEveUsage(one, {
    inputTokens: 5,
    outputTokens: 3,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
    costUsd: 0.01,
  })
  assert.deepEqual(total, {
    prompt_tokens: 15,
    completion_tokens: 8,
    cache_read_input_tokens: 14,
    cache_creation_input_tokens: 5,
    cost_usd: 0.02,
    agent_steps: 1,
  })
})

test("reports compaction spend even when the first model call fails", () => {
  const usage = addEveUsage(EMPTY_USAGE, {
    inputTokens: 15,
    outputTokens: 8,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.02,
  })
  assert.equal(usage.agent_steps, 0)
  assert.equal(usageOrNull(usage)?.cost_usd, 0.02)
})
