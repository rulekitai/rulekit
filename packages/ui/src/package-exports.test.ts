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
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
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

test("the rules package is a peer, and never a pinned dependency", () => {
  // `workspace:*` in `dependencies` is published as an EXACT version. Two costs
  // followed. An application on any other version of the rules package got a
  // SECOND copy of it inside this one, so the reader's answers were decoded by
  // a different build from the one that produced them. And a local tarball
  // could not be installed before its version was published: pnpm went to the
  // registry for the exact version and found nothing.
  //
  // A peer says the true thing. This package reads the event stream that the
  // rules package's server writes, so the two must be the same copy.
  assert.equal(
    MANIFEST.dependencies?.["@rulekitai/rulekit"],
    undefined,
    "@rulekitai/rulekit must be a peer dependency, so one copy serves both",
  )
  const range = MANIFEST.peerDependencies?.["@rulekitai/rulekit"]
  assert.ok(range, "@rulekitai/rulekit must be declared as a peer dependency")
  assert.match(range, /^[\^~]/, `the peer range "${range}" pins one version; accept a range`)
})
