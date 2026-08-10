// Copy the demo corpus into this package, so `rulekit init` works after an
// install from npm. npm can only ship files from inside the package directory,
// and the corpus lives at the root of the repository, where every other tool
// reads it.
import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const source = resolve(here, "../../../data/demo")
const target = resolve(here, "../data/demo")

await rm(target, { recursive: true, force: true })
await mkdir(dirname(target), { recursive: true })
// corpus.db is a build artifact. `rulekit init` gives somebody a starting
// point to edit, and a database compiled from an older copy of the JSON is
// worse than none: it answers, and it answers with the wrong rules.
await cp(source, target, { recursive: true, filter: (from) => !from.endsWith("corpus.db") })
console.log(`copied ${source} -> ${target}`)
