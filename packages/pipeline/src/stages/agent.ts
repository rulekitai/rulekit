import type { AgentEvent } from "@rulekitai/agent/events"
import type { AskInput } from "@rulekitai/agent/runtime"
import type { Answer, AskContext, Stage } from "../types.ts"

/**
 * The last stage. It can answer anything the others can, and everything they
 * cannot.
 *
 * Every stage before this one is an optimisation. This one is the product.
 */

/** The part of an agent this stage needs. Typed structurally so no import binds it. */
export type AgentLike = {
  stream(input: AskInput): AsyncGenerator<AgentEvent>
}

export function agentStage(agent: AgentLike): Stage {
  return {
    name: "agent",
    async run(ctx: AskContext): Promise<Answer | null> {
      let text = ""
      let done: Extract<AgentEvent, { type: "done" }> | null = null
      let error: string | null = null

      for await (const event of agent.stream({
        question: ctx.question,
        history: ctx.history,
        rules: ctx.retrieved,
      })) {
        if (event.type === "text") text = event.text
        else if (event.type === "done") done = event
        else if (event.type === "error") error = event.error
      }

      if (!done) throw new Error(error ?? "the agent produced no answer")
      // A failed turn that still wrote something keeps that text. The reader
      // waited for it, and a partial ruling beats an empty bubble.
      if (!done.text && error) throw new Error(error)

      return {
        text: done.text || text,
        citations: [],
        source: done.source,
        servedBy: "agent",
        latencyMs: done.latencyMs ?? 0,
        model: done.model ?? null,
        usage: done.usage ?? null,
        complete: done.complete,
      }
    },
  }
}

/**
 * The agent stage as a live event stream.
 *
 * The stage above collects the whole answer before returning, which is right for
 * a pipeline that has to decide whether a stage answered at all. A route that
 * streams to a browser wants the events as they happen, so it calls this instead
 * once the earlier stages have missed.
 */
export function streamAgent(agent: AgentLike, ctx: AskContext): AsyncGenerator<AgentEvent> {
  return agent.stream({ question: ctx.question, history: ctx.history, rules: ctx.retrieved })
}
