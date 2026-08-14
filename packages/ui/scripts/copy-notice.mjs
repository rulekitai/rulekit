// Copy the files that live at the root of this repository into this package
// before it is published. npm ships only files from inside the package
// directory, and `files` cannot reach above it.
//
// NOTICE: Apache 2.0 section 4(d) asks that a distribution carry the
// attribution notices of the work it builds on. npm adds LICENSE by itself and
// adds no NOTICE, so an earlier release shipped one and not the other, while
// the README said both went out.
//
// CHANGELOG: a published type changed shape between two releases, and the
// reader who met it had no list of changes to check. They found it by watching
// a runtime error.
import { cp, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const FILES = ["NOTICE", "CHANGELOG.md"]

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, "../../..")

for (const name of FILES) {
  const target = resolve(here, "..", name)
  await rm(target, { recursive: true, force: true })
  await cp(resolve(root, name), target)
  console.log(`copied ${name} -> ${target}`)
}
