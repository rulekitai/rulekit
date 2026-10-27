import { defineEval } from "eve/evals"

export default defineEval({
  async test(t) {
    for (const [question, complete] of [
      ["Read the rule", true],
      ["Reach the limit", false],
    ] as const) {
      const response = await t.target.fetch("/ask/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      })
      if (!response.ok) throw new Error(`Route returned ${response.status}`)
      const events = (await response.text())
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      const done = events.at(-1)
      if (done?.type !== "done" || done.complete !== complete)
        throw new Error(`Unexpected result: ${JSON.stringify(events)}`)
      if (done.usage?.agent_steps !== 2 || !done.usage?.prompt_tokens)
        throw new Error(`Unexpected usage: ${JSON.stringify(done)}`)
      if (!events.some((event) => event.type === "step" && event.step.status === "completed"))
        throw new Error("No completed rule lookup")
      if (complete && done.text !== "Rule 1.1 applies.") throw new Error(`Unexpected reply: ${done.text}`)
    }
  },
})
