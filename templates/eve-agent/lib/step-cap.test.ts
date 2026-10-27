import assert from "node:assert/strict"
import test from "node:test"
import { configuredStepCap, enforceStepCap } from "./step-cap.ts"

test("cancels continued tool work at the configured model-call cap", () => {
  let cancelled = false
  const cancel = () => {
    cancelled = true
  }
  enforceStepCap(1, { outcome: "completed", finishReason: "tool-calls" }, cancel, 2)
  assert.equal(cancelled, false)
  enforceStepCap(2, { outcome: "completed", finishReason: "tool-calls" }, cancel, 2)
  assert.equal(cancelled, true)
})

test("preserves a finished answer and leaves uncapped turns running", () => {
  const cancel = () => assert.fail("the turn must continue or finish normally")
  enforceStepCap(2, { outcome: "completed", finishReason: "stop" }, cancel, 2)
  enforceStepCap(101, { outcome: "completed", finishReason: "tool-calls" }, cancel, null)
  enforceStepCap(2, { outcome: "failed", finishReason: "tool-calls" }, cancel, 2)
})

test("ignores absent or invalid environment caps", () => {
  for (const value of [undefined, "", "invalid", "0", "-1", "Infinity"]) {
    assert.equal(configuredStepCap({ RULEKIT_STEP_CAP: value }), null)
  }
  assert.equal(configuredStepCap({ RULEKIT_STEP_CAP: "2" }), 2)
})
