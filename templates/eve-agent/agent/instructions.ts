import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildInstructions } from "@rulekit/agent/instructions"
import { parseProfile } from "@rulekit/agent/profile"
import { builtinSkills } from "@rulekit/agent/skills"
import { defineInstructions } from "eve/instructions"
import { CORPUS_DIR } from "../lib/corpus.ts"

/**
 * The system prompt, built from this corpus's profile.
 *
 * Eve discovers instructions from this filename, beside `agent.ts`. They cannot
 * be passed to `defineAgent`, which rejects the key.
 *
 * They are BUILT rather than written out, from the same profile the AI SDK
 * runtime reads. That is what stops the two runtimes drifting: a change to a
 * game's `profile.json` reaches both, and neither has a copy of the prompt that
 * somebody has to remember to update.
 *
 * The procedures are inlined here rather than loaded through Eve's own skill
 * mechanism. Eve would load one on demand, which costs a model call, and a turn
 * has few to spend.
 */

const profile = parseProfile(JSON.parse(readFileSync(resolve(CORPUS_DIR, "profile.json"), "utf8")))

export default defineInstructions({
  markdown: buildInstructions(profile, { skills: builtinSkills() }),
})
