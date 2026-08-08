import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseProfile } from "@rulekit/agent/profile"
import { defineRulesTools } from "@rulekit/agent/tools"
import { defineTool } from "eve/tools"
import { CORPUS_DIR, corpusStore } from "../corpus.ts"

/**
 * Every corpus tool, registered with Eve.
 *
 * The tools are defined once in `@rulekit/agent/tools` and adapted here. They
 * were written as `{ name, description, inputSchema, execute }` precisely so
 * that adapting them is this short: both Eve and the AI SDK accept that shape,
 * so neither framework appears in the tools themselves.
 *
 * Every one reads the local database. Nothing here calls `fetch`, so there is no
 * connection to configure, no schema to discover, and no list of permitted
 * operations that somebody has to keep correct. A tool that does not exist
 * cannot be called.
 */

const profile = parseProfile(JSON.parse(readFileSync(resolve(CORPUS_DIR, "profile.json"), "utf8")))

const tools = defineRulesTools(corpusStore(), profile)

export default Object.fromEntries(
  tools.map((tool) => [
    tool.name,
    defineTool({
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: (input: unknown) => tool.execute(input as never),
    }),
  ]),
)
