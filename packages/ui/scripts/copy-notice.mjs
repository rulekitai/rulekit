// Copy the NOTICE file into this package before it is published.
//
// Apache 2.0 section 4(d) asks that a distribution carry the attribution
// notices of the work it builds on. npm adds LICENSE by itself and adds no
// NOTICE, and `files` reads paths inside the package directory only, so the
// file at the root of the repository never travelled. An earlier release
// shipped one and not the other, while the README said both went out.
import { cp } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const target = resolve(here, "../NOTICE")

await cp(resolve(here, "../../../NOTICE"), target)
console.log(`copied NOTICE -> ${target}`)
