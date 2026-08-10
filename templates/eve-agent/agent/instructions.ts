import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { buildInstructions } from "@rulekitai/agent/instructions"
import { parseProfile } from "@rulekitai/agent/profile"
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
 * **The procedures are NOT inlined here.** Each one is a skill under
 * `agent/skills/`, and Eve advertises only its description until a question
 * matches it. Three procedures inlined would put all three in front of every
 * question, and a rules question would carry the card procedure for nothing.
 * The AI SDK runtime has no such mechanism, so it inlines them and pays for it.
 */

const profile = parseProfile(JSON.parse(readFileSync(resolve(CORPUS_DIR, "profile.json"), "utf8")))

export default defineInstructions({
  markdown: buildInstructions(profile),
})
