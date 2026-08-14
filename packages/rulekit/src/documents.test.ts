import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { describe, test } from "node:test"
import { profileSchema } from "./agent/profile.ts"

/**
 * Every document this project links must exist, and must reach a reader.
 *
 * Both halves failed at once in 0.4.0. The README linked seven documents that
 * were written but not yet on the default branch, so each link answered 404;
 * and `docs` was not in the published `files` list, so a reader who installed
 * from npm held no local copy either. The README was then the whole
 * documentation set for three features it does not fully explain.
 *
 * These tests read the repository and never the network. A link into this
 * project's own default branch names a path, and the path is here to check.
 */

const ROOT = resolve(import.meta.dirname, "../../..")

/** Tracked markdown only. A copy made by the build is not a source document. */
const MARKDOWN = execFileSync("git", ["ls-files", "*.md"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean)

/** The documents a reader who installed from npm can open. */
const SHIPPED = [
  "packages/rulekit/README.md",
  "packages/ui/README.md",
  ...MARKDOWN.filter((file) => file.startsWith("docs/")),
]

/** `[label](target)`, with the target captured. */
const LINK = /\[[^\]]*\]\(([^)\s]+)/g

/** A link into this project's own files on the default branch. */
const OWN_REPOSITORY = /^https:\/\/github\.com\/rulekitai\/rulekit\/(?:blob|tree)\/main\/(.+)$/

const links = (file: string): string[] =>
  [...readFileSync(join(ROOT, file), "utf8").matchAll(LINK)].map((match) => match[1] as string)

/** Drop a heading fragment, which names a place inside a file and not a file. */
const withoutFragment = (target: string) => target.split("#")[0] as string

describe("the documents this project links", () => {
  test("every relative link names a file that exists", () => {
    const broken: string[] = []
    for (const file of MARKDOWN) {
      for (const target of links(file)) {
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue
        const path = withoutFragment(target)
        if (!path) continue
        if (!existsSync(resolve(ROOT, dirname(file), path))) broken.push(`${file} -> ${target}`)
      }
    }
    assert.deepEqual(broken, [], `these links point at nothing:\n${broken.join("\n")}`)
  })

  test("every link into this project's own branch names a file that exists", () => {
    // A published README cannot use a relative link, because npm renders it far
    // from this repository. It uses a full address into the default branch
    // instead, and nothing else checks that the address still names anything.
    const broken: string[] = []
    for (const file of MARKDOWN) {
      for (const target of links(file)) {
        const path = OWN_REPOSITORY.exec(withoutFragment(target))?.[1]
        if (path && !existsSync(resolve(ROOT, path))) broken.push(`${file} -> ${target}`)
      }
    }
    assert.deepEqual(broken, [], `these links point at nothing:\n${broken.join("\n")}`)
  })

  test("the decline list the README prints is the one the assistant reads", () => {
    // A tool whose subject sits on this list is never called, and nothing says
    // so: the model answers that the subject is outside what it covers, and the
    // tool records zero calls. Printing the list is what makes that findable,
    // and a printed copy that has drifted is worse than none.
    const instructions = readFileSync(
      resolve(ROOT, "packages/rulekit/src/agent/instructions/base.md"),
      "utf8",
    )
    const readme = readFileSync(resolve(ROOT, "packages/rulekit/README.md"), "utf8")

    /** The first word of each bullet under a heading. One subject, one word. */
    const subjects = (text: string, after: string): string[] =>
      (text.split(after)[1] ?? "")
        .split(/\n#{2,3} /)[0]
        ?.split("\n")
        .map((line) => /^>?\s*- (\w+)/.exec(line)?.[1]?.toLowerCase())
        .filter((word): word is string => Boolean(word)) ?? []

    const declined = subjects(instructions, "## Decline these")
    const printed = subjects(readme, "**Decline these**")
    assert.ok(declined.length >= 7, "the instructions should still hold the list this test reads")
    assert.deepEqual(
      printed,
      declined,
      "the README's printed copy of the decline list no longer matches the instructions",
    )
  })

  test("no document teaches the one-argument disclaimer", () => {
    // `answerSource` falls back to the stage when it is given no origin, so a
    // one-argument call compiles, runs, and mislabels every cached model answer
    // as one no model wrote. Two packages ship one version here: one said that
    // fault was fixed while the other handed a reader the code that causes it.
    const bad: string[] = []
    for (const file of MARKDOWN) {
      const text = readFileSync(join(ROOT, file), "utf8")
      for (const call of text.matchAll(/answerSource\(([^)]*)\)/g)) {
        const args = (call[1] ?? "").split(",").filter((part) => part.trim())
        if (args.length < 2) bad.push(`${file}: answerSource(${call[1]})`)
      }
    }
    assert.deepEqual(bad, [], `these teach a call that mislabels a cached answer:\n${bad.join("\n")}`)
  })

  test("every field of the profile is named in a document that ships", () => {
    // The README sends a reader to `docs/corpus-format.md` for "every field".
    // Three fields were in no document at all, and the reader who wanted one of
    // them searched all seven and then read the build. A field nobody can read
    // about is a field nobody uses.
    const documented = SHIPPED.map((file) => readFileSync(join(ROOT, file), "utf8")).join("\n")
    const missing = Object.keys(profileSchema.shape).filter((field) => !documented.includes(field))
    assert.deepEqual(missing, [], `these profile fields are in no shipped document: ${missing}`)
  })

  test("every document the published README links travels in the package", () => {
    // A reader who installs from npm holds no clone. When a linked document
    // does not ship, the address above is the only copy they can reach, and it
    // needs a browser and a network to read.
    const manifest = JSON.parse(readFileSync(resolve(ROOT, "packages/rulekit/package.json"), "utf8")) as {
      files: string[]
    }
    const missing: string[] = []
    for (const target of links("packages/rulekit/README.md")) {
      const path = OWN_REPOSITORY.exec(withoutFragment(target))?.[1]
      if (!path) continue
      const top = path.split("/")[0] as string
      if (!manifest.files.includes(top) && !manifest.files.includes(path)) missing.push(path)
    }
    assert.deepEqual(missing, [], `the README links these, and the package ships none of them: ${missing}`)
  })
})
