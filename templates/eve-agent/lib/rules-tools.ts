import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseProfile } from "@rulekit/agent/profile"
import { defineRulesTools } from "@rulekit/agent/tools"
import { defineTool } from "eve/tools"
import { zodToJsonSchema } from "zod-to-json-schema"
import { CORPUS_DIR, corpusStore } from "./corpus.ts"

/**
 * Adapt the corpus tools to Eve, one at a time.
 *
 * Deliberately OUTSIDE `agent/`. Eve discovers every file under `agent/tools/`
 * as a tool whose NAME IS ITS FILENAME, and whose default export must be a
 * single tool. A helper module there fails the build, and a file exporting a
 * record of tools fails it too.
 *
 * The tools themselves are defined once in `@rulekit/agent/tools`, in a shape
 * both Eve and the AI SDK accept. That is why adapting them is three lines.
 */

const profile = parseProfile(JSON.parse(readFileSync(resolve(CORPUS_DIR, "profile.json"), "utf8")))

const byName = new Map(defineRulesTools(corpusStore(), profile).map((tool) => [tool.name, tool]))

/** Every tool this corpus offers. Each needs a file under `agent/tools/`. */
export const TOOL_NAMES = [...byName.keys()]

/**
 * One tool, ready for Eve.
 *
 * Throws on a name the corpus does not offer, rather than registering an empty
 * tool. A tool that exists and does nothing is worse than one that is absent:
 * the model will call it, get nothing, and report that nothing exists.
 */
export function eveTool(name: string) {
  const tool = byName.get(name)
  if (!tool) {
    throw new Error(
      `No corpus tool is named "${name}". This file should be deleted, or the corpus profile ` +
        `changed. Tools available: ${TOOL_NAMES.join(", ")}.`,
    )
  }
  return defineTool({
    description: tool.description,
    // JSON Schema, NOT the Zod schema itself.
    //
    // Eve accepts either, but handing it a Zod object here fails the build with
    // "Cannot read properties of undefined (reading 'input')". Eve reads the
    // Standard Schema `~standard.types.input` field, which Zod 3 declares for
    // the type system and does not create at run time. JSON Schema is plain
    // data, so it cannot disagree with whichever Zod version anything resolves.
    //
    // The tool's own Zod schema is still the single definition; this converts
    // it, so the two descriptions of one input cannot drift.
    inputSchema: zodToJsonSchema(tool.inputSchema, { target: "jsonSchema7" }),
    execute: (input: unknown) => tool.execute(input as never),
  })
}
