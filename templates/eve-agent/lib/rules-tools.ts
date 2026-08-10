import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseProfile } from "@rulekitai/agent/profile"
import { corpusContents, defineRulesTools } from "@rulekitai/agent/tools"
import { defineTool, disableTool } from "eve/tools"
import { z } from "zod"
import { CORPUS_DIR, corpusStore } from "./corpus.ts"

/**
 * Adapt the corpus tools to Eve, one at a time.
 *
 * Deliberately OUTSIDE `agent/`. Eve discovers every file under `agent/tools/`
 * as a tool whose NAME IS ITS FILENAME, and whose default export must be a
 * single tool. A helper module there fails the build, and a file exporting a
 * record of tools fails it too.
 *
 * The tools themselves are defined once in `@rulekitai/agent/tools`, in a shape
 * both Eve and the AI SDK accept. That is why adapting them is three lines.
 */

const profile = parseProfile(JSON.parse(readFileSync(resolve(CORPUS_DIR, "profile.json"), "utf8")))

// Top-level await, because knowing which collections hold anything needs a read.
// Eve builds this module once at discovery, so the cost is paid once.
const contents = await corpusContents(corpusStore())

const byName = new Map(defineRulesTools(corpusStore(), profile, contents).map((tool) => [tool.name, tool]))

/** Every tool this corpus offers. A file exists for each name Eve can serve. */
export const TOOL_NAMES = [...byName.keys()]

/**
 * One tool, ready for Eve.
 *
 * A file under `agent/tools/` exists for every tool this project can offer, and
 * Eve reads the directory rather than a list. A corpus that holds no banned
 * list therefore still has the file. Switching that tool off is the Eve way to
 * say so, and it keeps the two runtimes offering the same set: a tool that
 * exists and answers nothing is worse than one that is absent, because the
 * model calls it, gets nothing, and reports that nothing exists.
 */
export function eveTool(name: string) {
  const tool = byName.get(name)
  if (!tool) return disableTool()
  return defineTool({
    description: tool.description,
    // JSON Schema, NOT the Zod schema itself.
    //
    // Eve accepts either, but handing it a Zod object here fails the build with
    // "Cannot read properties of undefined (reading 'input')". Eve reads the
    // Standard Schema `~standard.types.input` field, which Zod declares for the
    // type system and does not create at run time. JSON Schema is plain data,
    // so it cannot disagree with whichever Zod version anything resolves.
    //
    // The conversion is Zod's own, from version 4. It replaced a separate
    // package that did the same job for version 3.
    //
    // The tool's own Zod schema is still the single definition; this converts
    // it, so the two descriptions of one input cannot drift.
    inputSchema: z.toJSONSchema(tool.inputSchema, { target: "draft-7" }),
    execute: (input: unknown) => tool.execute(input as never),
  })
}
