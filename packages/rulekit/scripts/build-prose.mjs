#!/usr/bin/env node
// Turn the authored Markdown into a TypeScript module.
//
// WHY THIS EXISTS. The instructions and the skills are prose, and prose belongs
// in Markdown where it can be read and reviewed. But reading that Markdown at
// run time needs a filesystem, and a bundler cannot see a path built from
// `import.meta.url`, so the files are silently left out of the bundle. The
// result is an assistant that throws on every question with a stack trace about
// a missing file — after it deploys, never before.
//
// Generating a module removes the failure rather than handling it. There is no
// path, no read, and nothing to leave out of a bundle.
//
// `src/prose.ts` IS CHECKED IN. A test compares it against the Markdown, so a
// forgotten regeneration fails a test instead of shipping stale instructions.

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "agent")

/** Escape text for a template literal: the backslash first, or it re-escapes. */
const forTemplateLiteral = (text) => text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")

function parseFrontMatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { fields: {}, body: raw.trim() }
  const fields = {}
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":")
    if (at !== -1) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { fields, body: match[2].trim() }
}

export function generate() {
  const base = readFileSync(join(SRC, "instructions", "base.md"), "utf8").trim()

  const skills = readdirSync(join(SRC, "skills"))
    .filter((file) => file.endsWith(".md"))
    .sort()
    .map((file) => {
      const { fields, body } = parseFrontMatter(readFileSync(join(SRC, "skills", file), "utf8"))
      return { name: fields.name ?? file.replace(/\.md$/, ""), description: fields.description ?? "", body }
    })

  return `// GENERATED FILE. Do not edit.
//
// Run \`node scripts/build-prose.mjs\` after changing any Markdown under
// src/instructions/ or src/skills/. A test compares this file against them, so
// a forgotten run fails a test rather than shipping stale instructions.
//
// It is generated rather than read at run time because a bundler cannot see a
// file a module reads by path, and leaves it out.

/** The grounding rules that hold for every rulebook. */
export const BASE_INSTRUCTIONS = \`${forTemplateLiteral(base)}\`

/** A procedure the model reads only when it applies. */
export type ProseSkill = { name: string; description: string; body: string }

export const SKILLS: ProseSkill[] = [
${skills
  .map(
    (skill) =>
      `  {\n    name: ${JSON.stringify(skill.name)},\n    description: ${JSON.stringify(skill.description)},\n    body: \`${forTemplateLiteral(skill.body)}\`,\n  },`,
  )
  .join("\n")}
]
`
}

// Written only when run directly, so the test can import `generate` and compare
// without the import itself rewriting the file it is checking.
if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(join(SRC, "prose.ts"), generate(), "utf8")
  console.log("wrote src/prose.ts")
}
