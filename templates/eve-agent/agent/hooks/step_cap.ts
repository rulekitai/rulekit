import { defineHook } from "eve/hooks"
import { enforceStepCap } from "../../lib/step-cap.ts"

export default defineHook({
  events: {
    "step.completed"(event, ctx) {
      enforceStepCap(event.data, () => ctx.cancel())
    },
  },
})
