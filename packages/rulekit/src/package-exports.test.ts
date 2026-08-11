import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

/**
 * No published export may name a condition that a build tool matches by itself.
 *
 * An `exports` block can list several addresses for one subpath and pick
 * between them by name. Node picks with `--conditions`. A build tool picks with
 * a list of its own, and Vite's list holds `development` while its dev server
 * runs, and `production` while it builds.
 *
 * This package once listed its TypeScript source under `development`. That is
 * useful here, where a script asks for it by name and skips the compile step.
 * It was harmful everywhere else: Vite matched the name without being asked,
 * loaded raw TypeScript out of `node_modules`, and pnpm stores a package behind
 * a symbolic link, from which the package cannot reach its own dependencies.
 * The dev server then failed on every request, and neither message it printed
 * named this package. The condition is now called `rulekit-source`, which no
 * build tool matches unless somebody asks for it.
 *
 * A `types` condition is safe, because TypeScript matches it on purpose and
 * reads a declaration file rather than source.
 */
const MANIFEST = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf8")) as {
  exports: Record<string, string | Record<string, string>>
}

/** Names a build tool matches with no instruction from anybody. */
const TOOL_MATCHED = ["development", "production", "browser", "node", "import", "require", "default"]

test("no export condition is one a build tool matches by itself", () => {
  for (const [subpath, entry] of Object.entries(MANIFEST.exports)) {
    if (typeof entry === "string") continue
    for (const condition of Object.keys(entry)) {
      if (condition === "types" || condition === "default") continue
      assert.ok(
        !TOOL_MATCHED.includes(condition),
        `${subpath} lists the "${condition}" condition, which a build tool matches by itself. ` +
          `Use "rulekit-source" for source, or "default" for the compiled output.`,
      )
    }
  }
})

test("the root export explains that every part has its own subpath", async () => {
  // Without this module the resolver refuses the import, and its refusal shows
  // no subpath and no example. A reader meets it before they meet the table in
  // the README that explains the layout.
  await assert.rejects(
    () => import("./index.ts"),
    (error: Error) => {
      assert.match(error.message, /no root export/)
      assert.match(error.message, /@rulekitai\/rulekit\/server\/handler/)
      return true
    },
  )
})

test("every export a build tool reaches is compiled output", () => {
  for (const [subpath, entry] of Object.entries(MANIFEST.exports)) {
    if (typeof entry === "string") continue
    assert.ok(
      entry.default?.startsWith("./dist/"),
      `${subpath} must fall back to ./dist/, so an install from npm never loads TypeScript.`,
    )
  }
})
