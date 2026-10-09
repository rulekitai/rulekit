import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { parseProfile } from "@rulekitai/rulekit/agent/profile"
import { findSkill } from "@rulekitai/rulekit/agent/skills"
import { corpusContents, defineRulesTools } from "@rulekitai/rulekit/agent/tools"
import { defineSkill } from "eve/skills"
import { defineDynamic, defineTool } from "eve/tools"
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
 * The tools themselves are defined once in `@rulekitai/rulekit/agent/tools`, in a shape
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
 * list therefore still has the file, and the tool has to disappear instead: a
 * tool that exists and answers nothing is worse than one that is absent,
 * because the model calls it, gets nothing, and reports that nothing exists.
 *
 * A resolver that returns `null` is how Eve says "no tool here". It is NOT
 * `disableTool()`: that sentinel removes a FRAMEWORK tool by name (`bash`,
 * `web_fetch`, and the rest of the list Eve owns), and Eve rejects it
 * for any other name while it resolves the agent graph:
 *
 *     agent/tools/list_rulings.ts exports disableTool() but "list_rulings" is
 *     not a framework tool. Rename the file to one of: agent, ask_question, ...
 *
 * That error costs a whole session to place, because `eve build` and `eve info`
 * both accept the file and only `eve start` reads the graph. `data/riftbound`
 * ships an empty `rulings.json`, so `list_rulings` is the tool that finds it.
 *
 * The resolver captures nothing, which matters: since 0.43.0 Eve stores each
 * callback's closure values and rejects any that is not JSON-serializable.
 */
/**
 * One procedure, ready for Eve, and switched off when its tool is absent.
 *
 * A dynamic resolver can omit a skill, as it can omit a tool. The AI SDK
 * runtime also drops procedures whose tools are absent. Without this, Eve
 * would hand the model a procedure
 * that names `list_rulings` for a corpus that holds no ruling, and the model
 * would call a tool that is not there.
 *
 * The procedure states its own requirement, in the `requires-tool` field of its
 * front matter. This function reads that field, so a procedure that gains a
 * requirement needs no edit here.
 */
export function eveSkill(name: string) {
  const skill = findSkill(name)
  if (!skill) throw new Error(`the ${name} skill is missing from @rulekitai/rulekit/agent/skills`)
  const needs = skill.requiresTool
  if (needs && !byName.has(needs)) {
    return defineDynamic({ events: { "session.started": () => null } })
  }
  return defineSkill({ description: skill.description, markdown: skill.body })
}

export function eveTool(name: string) {
  const tool = byName.get(name)
  if (!tool) return defineDynamic({ events: { "session.started": () => null } })
  return defineTool({
    description: tool.description,
    // Plain JSON Schema keeps this adapter independent of Eve's schema
    // compiler. Zod remains the single input definition for both runtimes.
    inputSchema: z.toJSONSchema(tool.inputSchema, { target: "draft-7" }),
    // Capture the tool name, which is serializable. The module-level lookup
    // keeps the RuleTool object and its execute function out of durable state.
    execute: (input: unknown) => byName.get(name)?.execute(input as never),
  })
}
