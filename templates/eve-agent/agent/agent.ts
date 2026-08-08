import { defineAgent } from "eve"

/**
 * The agent, on Eve.
 *
 * The instructions are NOT here. Eve discovers them from `agent/instructions.ts`
 * beside this file, which builds them from the same profile the AI SDK runtime
 * reads. Passing them to `defineAgent` fails the build with "Unknown key".
 */

/**
 * The model.
 *
 * A plain "provider/model" string routes through the AI Gateway, so changing
 * provider is one environment variable. Nothing here requires a particular one.
 */
const model = process.env.RULEKIT_MODEL ?? "anthropic/claude-sonnet-5"

export default defineAgent({
  model,

  /**
   * Grounded quote-and-cite work needs little chain of thought. The tools supply
   * the facts; the model reads, quotes, and cites. Low effort keeps a turn fast.
   * Raise it if answers about interactions between several cards get weaker.
   */
  reasoning: "low",

  /**
   * The outer bound on one session, not on one question.
   *
   * These stay wide on purpose. What bounds a single question is the step cap in
   * `@rulekit/agent/turn`, enforced in the channel. Eve answers a session that
   * runs out of budget by parking the turn on a prompt nobody is there to
   * answer, which is a worse outcome for a reader than a capped answer, so these
   * should only ever be reached by something pathological.
   */
  limits: {
    maxInputTokensPerSession: 2_000_000,
    maxOutputTokensPerSession: 200_000,
  },
})
