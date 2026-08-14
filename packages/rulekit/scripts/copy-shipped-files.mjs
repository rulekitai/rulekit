// Copy everything that lives at the root of this repository but has to travel
// inside the published package. npm ships only files from inside the package
// directory, and `files` cannot reach above it, so each one is copied here
// before a build.
//
// THE DOCUMENTS ARE THE REASON THIS MATTERS MOST. The README links seven of
// them. A reader who installed from npm followed those links to a 404, because
// the documents stayed in the repository, and the README was then the whole
// documentation set for three features it does not fully explain.
//
// FOUR OF THE FIVE CORPORA, and never the fifth. Riot Games owns the Riftbound
// data and permits non-commercial use only, so it cannot travel inside a package
// that anybody may use commercially. It stays in the repository, and the command
// says where to find it. The four here carry a CC0 1.0 dedication.
//
// THE NOTICE FILE TRAVELS TOO. Apache 2.0 section 4(d) asks that a distribution
// carry the attribution notices of the work it builds on. npm adds LICENSE by
// itself and adds no NOTICE, so an earlier release shipped one and not the
// other, while the README said both went out.
import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const CORPORA = ["demo", "chess", "texas-holdem", "estate-line"]

/** Root path, package path. Each pair is copied as it is. */
const FILES = [
  ["NOTICE", "NOTICE"],
  ["CHANGELOG.md", "CHANGELOG.md"],
  ["docs", "docs"],
  // The skills tell an agent how to use this package. They were written for
  // somebody standing in this repository, and a reader who installs from npm
  // holds no clone, so they ship too.
  [".claude/skills", "skills"],
]

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../../..")

for (const [from, to] of FILES) {
  const target = resolve(here, "..", to)
  await rm(target, { recursive: true, force: true })
  await cp(resolve(root, from), target, { recursive: true })
  console.log(`copied ${from} -> ${target}`)
}

const data = resolve(here, "../data")
await rm(data, { recursive: true, force: true })
await mkdir(data, { recursive: true })

for (const name of CORPORA) {
  const source = resolve(root, "data", name)
  // corpus.db is a build artefact. `rulekit init` gives somebody a starting
  // point to edit, and a database compiled from an older copy of the JSON is
  // worse than none: it answers, and it answers with the wrong rules.
  await cp(source, resolve(data, name), {
    recursive: true,
    filter: (from) => !from.endsWith("corpus.db"),
  })
  console.log(`copied ${source} -> ${resolve(data, name)}`)
}
