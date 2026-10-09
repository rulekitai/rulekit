import { addStepUsage, type UsageTotals } from "@rulekitai/rulekit/agent/turn"
import type { SessionWaitingStreamEvent, StepCompletedStreamEvent } from "eve/client"

export function addEveStepUsage(
  totals: UsageTotals,
  usage: StepCompletedStreamEvent["data"]["usage"],
): UsageTotals {
  return addStepUsage(totals, {
    ...usage,
    cachedInputTokens: usage?.cacheReadTokens,
    cacheCreationInputTokens: usage?.cacheWriteTokens,
  })
}

export function withEveSessionUsage(
  totals: UsageTotals,
  usage: SessionWaitingStreamEvent["data"]["usage"],
): UsageTotals {
  if (!usage) return totals
  // Each request creates one session. Its totals include compaction calls,
  // which have no step.completed event and must not increase agent_steps.
  return {
    ...totals,
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    cache_read_input_tokens: usage.cacheReadTokens,
    cache_creation_input_tokens: usage.cacheWriteTokens,
    cost_usd: usage.costUsd ?? totals.cost_usd,
    agent_steps: totals.agent_steps ?? 0,
  }
}
