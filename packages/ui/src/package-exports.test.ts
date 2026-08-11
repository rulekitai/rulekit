import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

/**
 * No published export may name a condition that a build tool matches by itself.
 *
 * This package is the one a browser loads, so it is the one the fault hurt
 * most. Both packages once listed their TypeScript source under `development`,
 * Vite matched that name with no instruction from anybody, and the dev server
 * of every application that installed this package failed on every request. The
 * condition is now called `rulekit-source`. The same test guards the other
 * package, where the reasoning is written out in full.
 *
 * `./styles.css` is a plain address rather than a set of choices, and it points
 * at source on purpose: a stylesheet is shipped as written and never compiled.
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
  await assert.rejects(
    () => import("./index.ts"),
    (error: Error) => {
      assert.match(error.message, /no root export/)
      assert.match(error.message, /@rulekitai\/ui\/chat/)
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
