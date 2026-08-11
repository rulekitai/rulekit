/**
 * The root of the package, which exists only to explain that there is no root.
 *
 * Every part of this package is imported by its own subpath, so a reader takes
 * the corpus store without the agent, or the agent without the command. Without
 * this file, `import ... from "@rulekitai/rulekit"` fails in the module
 * resolver, and that failure names no subpath and shows no example. A reader
 * meets it before they meet the table in the README that explains the layout.
 *
 * So the root is a real module, and importing it throws the sentence the
 * resolver could not write.
 */
export {}

throw new Error(
  `@rulekitai/rulekit has no root export. Every part is imported by its own subpath, for example:\n` +
    `  import { createAskHandler } from "@rulekitai/rulekit/server/handler"\n` +
    `  import { SqliteStore } from "@rulekitai/rulekit/corpus/sqlite-store"\n` +
    `The whole list is in the README, under "The subpaths":\n` +
    `  https://github.com/rulekitai/rulekit/tree/main/packages/rulekit#the-subpaths`,
)
