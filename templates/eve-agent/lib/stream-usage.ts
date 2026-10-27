import { addStepUsage, type UsageTotals } from "@rulekitai/rulekit/agent/turn"
import type { UsageRecordedData } from "eve/events"

/** A usage record can be a model call, compaction, or delegated work. */
export function addEveUsage(totals: UsageTotals, usage: UsageRecordedData["usage"]): UsageTotals {
  const accumulated = addStepUsage(totals, {
    ...usage,
    cachedInputTokens: usage.cacheReadTokens,
    cacheCreationInputTokens: usage.cacheWriteTokens,
  })
  return { ...accumulated, agent_steps: totals.agent_steps ?? 0 }
}
