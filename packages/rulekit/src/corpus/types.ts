import type { z } from "zod"
import type {
  banlistEntrySchema,
  cardRefSchema,
  cardSchema,
  erratumSchema,
  gameSchema,
  patchNoteSchema,
  ruleBookSchema,
  ruleSchema,
  sectionSchema,
  termSchema,
} from "./schema.ts"

export type Game = z.output<typeof gameSchema>
export type RuleBook = z.output<typeof ruleBookSchema>
export type Section = z.output<typeof sectionSchema>
export type Rule = z.output<typeof ruleSchema>
export type Term = z.output<typeof termSchema>
export type CardRef = z.output<typeof cardRefSchema>
export type Erratum = z.output<typeof erratumSchema>
export type BanlistEntry = z.output<typeof banlistEntrySchema>
export type PatchNote = z.output<typeof patchNoteSchema>
export type Card = z.output<typeof cardSchema>

/** Every collection, in memory. This is what a builder writes and a JSON store reads. */
export type Corpus = {
  game: Game
  rulebooks: RuleBook[]
  sections: Section[]
  rules: Rule[]
  terms: Term[]
  errata: Erratum[]
  banlist: BanlistEntry[]
  patchNotes: PatchNote[]
  cards: Card[]
}

/** A rule with its search score. Higher is a better match. */
export type RuleHit = Rule & { score: number }

/** The card identity a name search returns, before the full card is read. */
export type CardSummary = {
  id: string
  name: string
  type_line: string | null
  png_uri: string | null
}

/** Every printed name in the corpus, with its image path. */
export type CardName = { id: string; name: string; png_uri: string | null }

/** What one unified search found, by kind. */
export type SearchAllResult = {
  rules: RuleHit[]
  terms: Term[]
  errata: Erratum[]
  banlist: BanlistEntry[]
  patchNotes: PatchNote[]
}
