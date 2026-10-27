import { defineAgent } from "eve"
import { mockModel } from "eve/evals"

export default defineAgent({
  defaultTools: false,
  model: mockModel(({ lastUserMessage, toolResults }) => {
    if (lastUserMessage?.includes("limit") || toolResults.length === 0) {
      return {
        text: "Looking up the rule.",
        toolCalls: [{ name: "get_rule", input: { rule_number: "1.1" } }],
      }
    }
    return "Rule 1.1 applies."
  }),
})
