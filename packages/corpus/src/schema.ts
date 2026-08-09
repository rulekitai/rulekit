import { z } from "zod"

/**
 * The corpus format version.
 *
 * Every file in a corpus directory carries this number. The loader refuses a
 * number it does not know rather than reading the file anyway: a field that
 * moved between versions would otherwise arrive as `undefined`, and a rules
 * assistant that silently loses `content` answers every question from nothing.
 *
 * Bump it whenever a field is renamed, removed, or changes meaning. Adding an
 * optional field does not need a bump, because an older corpus still reads.
 */
export const SCHEMA_VERSION = 2

/** Trim to a string, or null. An empty or whitespace-only value counts as absent. */
const nullableText = z.union([z.string(), z.null(), z.undefined()]).transform((v) => {
  const text = typeof v === "string" ? v.trim() : ""
  return text ? text : null
})

/** Text that must exist, but may legitimately be empty (a section header has no body). */
const text = z.union([z.string(), z.null(), z.undefined()]).transform((v) => (typeof v === "string" ? v : ""))

const stringList = z
  .union([z.array(z.string()), z.null(), z.undefined()])
  .transform((v) => (Array.isArray(v) ? v : []))

const int = (fallback: number) =>
  z
    .union([z.number(), z.null(), z.undefined()])
    .transform((v) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : fallback))

const bool = (fallback: boolean) =>
  z.union([z.boolean(), z.null(), z.undefined()]).transform((v) => (typeof v === "boolean" ? v : fallback))

/** The corpus names itself and nothing else. Presentation belongs in the profile. */
export const gameSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
})

export const ruleBookSchema = z.object({
  id: z.string().min(1),
  name: text,
  slug: text,
  version: nullableText,
  effective_date: nullableText,
  is_active: bool(true),
})

export const sectionSchema = z.object({
  id: z.string().min(1),
  rule_book_id: z.string().min(1),
  section_number: text,
  title: text,
  slug: nullableText,
  description: nullableText,
  display_order: int(0),
})

/**
 * One rule.
 *
 * `parent_id` is the load-bearing field, and it is why a corpus cannot be built
 * from rule numbers alone. Rule numbers repeat across rulebooks, so the same
 * number can name two rules with two different parents. The link is data, not
 * something a reader may infer.
 *
 * `rule_type` separates a real rule from a section header. Roughly one row in
 * five is a header with empty `content`, and a search that cannot skip them
 * returns blank results at the top.
 */
export const ruleSchema = z.object({
  id: z.string().min(1),
  rule_book_id: z.string().min(1),
  section_id: nullableText,
  parent_id: nullableText,
  rule_number: text,
  slug: nullableText,
  title: nullableText,
  content: text,
  example: nullableText,
  depth: int(0),
  display_order: int(0),
  rule_type: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : "rule")),
  keywords: stringList,
  /** Rule numbers this rule points at. `getRelated` resolves them to rules. */
  cross_references: stringList,
  is_deprecated: bool(false),
  deprecation_note: nullableText,
})

export const termSchema = z.object({
  id: z.string().min(1),
  term: z.string().min(1),
  slug: text,
  definition: text,
  short_definition: nullableText,
  category: nullableText,
  aliases: stringList,
  defining_rule_id: nullableText,
  defining_rule_number: nullableText,
})

/** The card identity an errata or banlist row carries inline. */
export const cardRefSchema = z.object({
  id: nullableText,
  name: nullableText,
  png_uri: nullableText,
})

export const erratumSchema = z.object({
  id: z.string().min(1),
  card: z.union([cardRefSchema, z.null()]).default(null),
  effective_date: nullableText,
  original_text: nullableText,
  errata_text: nullableText,
  explanation: nullableText,
  patch_note_slug: nullableText,
  patch_note_title: nullableText,
})

export const banlistEntrySchema = z.object({
  id: z.string().min(1),
  card: z.union([cardRefSchema, z.null()]).default(null),
  format: z
    .union([z.object({ id: nullableText, name: nullableText, slug: nullableText }), z.null(), z.undefined()])
    .transform((v) => v ?? null),
  entry_type: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (typeof v === "string" && v.trim() ? v.trim() : "banned")),
  effective_date: nullableText,
  reason: nullableText,
  patch_note_slug: nullableText,
  patch_note_title: nullableText,
})

export const patchNoteSchema = z.object({
  id: z.string().min(1),
  slug: text,
  title: text,
  version: nullableText,
  effective_date: nullableText,
  category: nullableText,
  summary: nullableText,
  body: nullableText,
  affected_rule_ids: stringList,
  affected_card_ids: stringList,
})

/** Drop the keys with no value. A key this game does not use must be absent, not empty. */
const namedValues = <T extends z.ZodType>(value: T) =>
  z
    .union([z.record(z.string(), value), z.null(), z.undefined()])
    .transform((v) => Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => !isEmpty(x))))

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0)

/**
 * One card, trimmed to what a rules answer needs.
 *
 * Only identity is fixed, because only identity is the same in every game. A
 * card's text boxes and its printed attributes are exactly the parts that
 * differ, so each is a map you name yourself: a game with Attack and Defence
 * writes those keys, another writes Might and Energy, and neither has to
 * pretend to be the other or carry the other's empty columns.
 *
 * **`text` usually holds more than one box.** An equipment card commonly prints
 * almost nothing in its own box and everything in the box its holder gains, so
 * an assistant reading one box reports that the card does nothing. Name every
 * box you use in the profile's `cards.textFields` and all of them get read.
 */
export const cardSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type_line: nullableText,
  rarity: nullableText,
  set_name: nullableText,
  png_uri: nullableText,
  tags: stringList,
  text: namedValues(z.string()),
  stats: namedValues(z.unknown()),
})

/** Every collection file on disk. The key is also the file name, without `.json`. */
export const COLLECTION_SCHEMAS = {
  rulebooks: ruleBookSchema,
  sections: sectionSchema,
  rules: ruleSchema,
  terms: termSchema,
  errata: erratumSchema,
  banlist: banlistEntrySchema,
  "patch-notes": patchNoteSchema,
  cards: cardSchema,
} as const

export type CollectionName = keyof typeof COLLECTION_SCHEMAS

export const COLLECTION_NAMES = Object.keys(COLLECTION_SCHEMAS) as CollectionName[]

/**
 * A collection file: a version stamp and the rows.
 *
 * The version sits in the file rather than in one manifest so a directory
 * assembled from more than one producer still declares what each part is.
 */
export const collectionFileSchema = z.object({
  schemaVersion: z.number().int(),
  items: z.array(z.unknown()),
})

export const gameFileSchema = z.object({
  schemaVersion: z.number().int(),
  game: gameSchema,
})
