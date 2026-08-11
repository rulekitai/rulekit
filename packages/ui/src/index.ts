/**
 * The root of the package, which exists only to explain that there is no root.
 *
 * Every component and every hook is imported by its own subpath, so an
 * application that wants the hooks alone never loads the styled components.
 * Without this file, `import ... from "@rulekitai/ui"` fails in the module
 * resolver, and that failure names no subpath and shows no example.
 */
export {}

throw new Error(
  `@rulekitai/ui has no root export. Every component and hook is imported by its own subpath, for example:\n` +
    `  import { Chat } from "@rulekitai/ui/chat"\n` +
    `  import { RuleKitProvider } from "@rulekitai/ui/provider"\n` +
    `  import "@rulekitai/ui/styles.css"\n` +
    `The whole list is in the README:\n` +
    `  https://github.com/rulekitai/rulekit/tree/main/packages/ui#use`,
)
