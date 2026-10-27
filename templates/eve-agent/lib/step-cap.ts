import type { ModelSettledData } from "eve/events"

export function configuredStepCap(env = process.env): number | null {
  const cap = Number(env.RULEKIT_STEP_CAP)
  return Number.isFinite(cap) && cap > 0 ? cap : null
}

export function enforceStepCap(
  count: number,
  step: Pick<ModelSettledData, "finishReason" | "outcome">,
  cancel: () => void,
  cap = configuredStepCap(),
): void {
  // Completed-step hooks run before Eve starts another model call. Reader
  // cancellation cannot stop that work. A final answer needs no cancellation.
  if (cap !== null && count >= cap && step.outcome === "completed" && step.finishReason === "tool-calls")
    cancel()
}
