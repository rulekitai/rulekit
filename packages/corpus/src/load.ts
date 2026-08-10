import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { z } from "zod"
import {
  COLLECTION_NAMES,
  COLLECTION_SCHEMAS,
  type CollectionName,
  collectionFileSchema,
  gameFileSchema,
  SCHEMA_VERSION,
} from "./schema.ts"
import { normalizeName } from "./text.ts"
import type { Corpus } from "./types.ts"

/** One thing wrong with a corpus, named precisely enough to fix. */
export type CorpusProblem = {
  file: string
  /** The row index inside `items`, or null for a whole-file problem. */
  index: number | null
  message: string
}

export type LoadResult =
  | { ok: true; corpus: Corpus; problems: CorpusProblem[] }
  | { ok: false; corpus: null; problems: CorpusProblem[] }

/** Read and parse one JSON file, or report why it could not be read. */
async function readJson(dir: string, name: string): Promise<{ data?: unknown; problem?: CorpusProblem }> {
  const file = `${name}.json`
  let raw: string
  try {
    raw = await readFile(join(dir, file), "utf8")
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    return {
      problem: {
        file,
        index: null,
        message: code === "ENOENT" ? "file is missing" : `could not be read: ${String(err)}`,
      },
    }
  }
  try {
    return { data: JSON.parse(raw) }
  } catch (err) {
    return { problem: { file, index: null, message: `is not valid JSON: ${String(err)}` } }
  }
}

/** Format a Zod issue as one readable line. */
function issueLine(issue: z.ZodIssue): string {
  const path = issue.path.join(".")
  return path ? `${path}: ${issue.message}` : issue.message
}

/**
 * Read a corpus directory, validating every row.
 *
 * Rows that fail validation are DROPPED and reported, and the load still
 * succeeds. That is deliberate: one malformed card must not cost a reader the
 * whole rulebook. A missing file or a version mismatch does fail the load,
 * because neither has a partial reading that means anything.
 */
export async function loadCorpus(dir: string): Promise<LoadResult> {
  const problems: CorpusProblem[] = []
  let fatal = false

  const gameFile = await readJson(dir, "game")
  if (gameFile.problem) {
    problems.push(gameFile.problem)
    return { ok: false, corpus: null, problems }
  }
  const gameParsed = gameFileSchema.safeParse(gameFile.data)
  if (!gameParsed.success) {
    problems.push({
      file: "game.json",
      index: null,
      message: gameParsed.error.issues.map(issueLine).join("; "),
    })
    return { ok: false, corpus: null, problems }
  }
  if (gameParsed.data.schemaVersion !== SCHEMA_VERSION) {
    problems.push({
      file: "game.json",
      index: null,
      message:
        `declares schemaVersion ${gameParsed.data.schemaVersion}, but this reader understands ` +
        `${SCHEMA_VERSION}. Rebuild the corpus with a matching version.`,
    })
    return { ok: false, corpus: null, problems }
  }

  const collections = {} as Record<CollectionName, unknown[]>

  for (const name of COLLECTION_NAMES) {
    collections[name] = []
    const file = await readJson(dir, name)
    if (file.problem) {
      problems.push(file.problem)
      fatal = true
      continue
    }
    const outer = collectionFileSchema.safeParse(file.data)
    if (!outer.success) {
      problems.push({
        file: `${name}.json`,
        index: null,
        message: `must be an object with schemaVersion and items: ${outer.error.issues.map(issueLine).join("; ")}`,
      })
      fatal = true
      continue
    }
    if (outer.data.schemaVersion !== SCHEMA_VERSION) {
      problems.push({
        file: `${name}.json`,
        index: null,
        message: `declares schemaVersion ${outer.data.schemaVersion}, but this reader understands ${SCHEMA_VERSION}`,
      })
      fatal = true
      continue
    }

    const schema = COLLECTION_SCHEMAS[name]
    const rows: unknown[] = []
    outer.data.items.forEach((item, index) => {
      const parsed = schema.safeParse(item)
      if (parsed.success) rows.push(parsed.data)
      else
        problems.push({ file: `${name}.json`, index, message: parsed.error.issues.map(issueLine).join("; ") })
    })
    collections[name] = rows
  }

  if (fatal) return { ok: false, corpus: null, problems }

  const corpus: Corpus = {
    game: gameParsed.data.game,
    rulebooks: collections.rulebooks as Corpus["rulebooks"],
    sections: collections.sections as Corpus["sections"],
    rules: collections.rules as Corpus["rules"],
    terms: collections.terms as Corpus["terms"],
    errata: collections.errata as Corpus["errata"],
    banlist: collections.banlist as Corpus["banlist"],
    patchNotes: collections["patch-notes"] as Corpus["patchNotes"],
    cards: collections.cards as Corpus["cards"],
  }

  return { ok: true, corpus, problems }
}

/**
 * Check that every link in a corpus points at something that exists.
 *
 * Schema validation proves each row is shaped right. It cannot prove that a
 * rule's `parent_id` names a rule in the same file. A dangling parent is the
 * failure that matters most here, because the hierarchy tools walk those links
 * and a broken one silently truncates a branch of the rulebook.
 */
export function checkIntegrity(corpus: Corpus): CorpusProblem[] {
  const problems: CorpusProblem[] = []
  const bookIds = new Set(corpus.rulebooks.map((b) => b.id))
  const sectionIds = new Set(corpus.sections.map((s) => s.id))
  const ruleIds = new Set(corpus.rules.map((r) => r.id))
  const cardIds = new Set(corpus.cards.map((c) => c.id))

  const report = (file: string, index: number, message: string) => problems.push({ file, index, message })

  corpus.sections.forEach((section, index) => {
    if (!bookIds.has(section.rule_book_id))
      report("sections.json", index, `rule_book_id "${section.rule_book_id}" names no rulebook`)
  })

  corpus.rules.forEach((rule, index) => {
    if (!bookIds.has(rule.rule_book_id))
      report("rules.json", index, `rule_book_id "${rule.rule_book_id}" names no rulebook`)
    if (rule.section_id && !sectionIds.has(rule.section_id))
      report("rules.json", index, `section_id "${rule.section_id}" names no section`)
    if (rule.parent_id && !ruleIds.has(rule.parent_id))
      report("rules.json", index, `parent_id "${rule.parent_id}" names no rule`)
    if (rule.parent_id === rule.id) report("rules.json", index, "is its own parent")
  })

  // Two terms that answer to one word. The glossary looks a term up by an exact
  // key, so a shared key resolves by whichever row the database returns first.
  // The reader then gets a definition that depends on insertion order, which is
  // a wrong answer that looks right and changes without warning.
  const claimedBy = new Map<string, string>()
  corpus.terms.forEach((term, index) => {
    if (term.defining_rule_id && !ruleIds.has(term.defining_rule_id))
      report("terms.json", index, `defining_rule_id "${term.defining_rule_id}" names no rule`)

    for (const spelling of [term.term, ...term.aliases]) {
      const key = normalizeName(spelling)
      if (!key) continue
      const owner = claimedBy.get(key)
      if (owner && owner !== term.term) {
        report(
          "terms.json",
          index,
          `"${spelling}" is already a name or alias of "${owner}", so a lookup for it is ambiguous`,
        )
      } else {
        claimedBy.set(key, term.term)
      }
    }
  })

  corpus.patchNotes.forEach((note, index) => {
    for (const id of note.affected_rule_ids)
      if (!ruleIds.has(id))
        report("patch-notes.json", index, `affected_rule_ids holds "${id}", which names no rule`)
    for (const id of note.affected_card_ids)
      if (!cardIds.has(id))
        report("patch-notes.json", index, `affected_card_ids holds "${id}", which names no card`)
  })

  // A cycle in the parent chain hangs every tool that walks upward. Finding it
  // here is cheap; finding it in production is a request that never returns.
  const parentOf = new Map(corpus.rules.map((r) => [r.id, r.parent_id]))
  corpus.rules.forEach((rule, index) => {
    const seen = new Set<string>([rule.id])
    let cursor = rule.parent_id
    while (cursor) {
      if (seen.has(cursor)) {
        report("rules.json", index, `parent chain forms a cycle at "${cursor}"`)
        break
      }
      seen.add(cursor)
      cursor = parentOf.get(cursor) ?? null
    }
  })

  return problems
}
