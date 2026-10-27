import { defineTool } from "eve/tools"
import { z } from "zod"

export default defineTool({
  description: "Look up a rule.",
  inputSchema: z.object({ rule_number: z.string() }),
  execute: ({ rule_number }) => ({ rule_number, text: "Rule 1.1 applies." }),
})
