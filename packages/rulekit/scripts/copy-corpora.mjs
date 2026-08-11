// Copy the public-domain corpora into this package, so `rulekit init` can hand
// somebody a real game after an install from npm. npm ships only files from
// inside the package directory, and the corpora live at the root of the
// repository, where every other tool reads them.
//
// FOUR OF THE FIVE, and never the fifth. Riot Games owns the Riftbound data and
// permits non-commercial use only, so it cannot travel inside a package that
// anybody may use commercially. It stays in the repository, and the command
// says where to find it. The four here carry a CC0 1.0 dedication.
import { cp, mkdir, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const CORPORA = ["demo", "chess", "texas-holdem", "estate-line"]

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, "../data")

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })

for (const name of CORPORA) {
  const source = resolve(here, "../../../data", name)
  // corpus.db is a build artefact. `rulekit init` gives somebody a starting
  // point to edit, and a database compiled from an older copy of the JSON is
  // worse than none: it answers, and it answers with the wrong rules.
  await cp(source, resolve(target, name), {
    recursive: true,
    filter: (from) => !from.endsWith("corpus.db"),
  })
  console.log(`copied ${source} -> ${resolve(target, name)}`)
}
