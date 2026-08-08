import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildInstructions } from "@rulekit/agent/instructions"
import { parseProfile } from "@rulekit/agent/profile"
import { builtinSkills } from "@rulekit/agent/skills"
import { defineAgent } from "eve"
import { CORPUS_DIR } from "./corpus.ts"

/**
 * The agent, on Eve.
 *
 * The instructions are built from the same profile the AI SDK runtime reads, so
 * a change to a game's profile reaches both runtimes and neither can drift.
 */

const profile = parseProfile(JSON.parse(readFileSync(resolve(CORPUS_DIR, "profile.json"), "utf8")))

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

  instructions: buildInstructions(profile, { skills: builtinSkills() }),

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
