import { defineState } from "eve/context"
import { defineHook } from "eve/hooks"
import { enforceStepCap } from "../../lib/step-cap.ts"

const modelCalls = defineState("rulekit.model-calls", () => ({ turnId: "", runId: "", count: 0 }))

export default defineHook({
  events: {
    "turn.started"(event) {
      modelCalls.update(() => ({ turnId: event.data.turnId, runId: "", count: 0 }))
    },
    "model.requested"(event) {
      if (!("turnId" in event.data.owner)) return
      const turnId = event.data.owner.turnId
      modelCalls.update((state) => ({
        turnId,
        runId: event.data.runId,
        count: state.turnId === turnId ? state.count + 1 : 1,
      }))
    },
    "model.settled"(event, ctx) {
      const state = modelCalls.get()
      if (state.runId === event.data.runId) enforceStepCap(state.count, event.data, () => ctx.cancel())
    },
  },
})
