import { z } from "zod"

/**
 * A profile is everything about one game that the instructions cannot know.
 *
 * The base instructions hold what is true of every rulebook: cite what a tool
 * returned, quote rather than restate, never invent, stay in role. This holds
 * the rest. Adding a game means writing one of these, not editing a prompt.
 *
 * Every field is optional except the game's name. A profile of one line produces
 * a working assistant; the rest sharpens it.
 */

const nonEmpty = z.string().trim().min(1)

export const vocabularyRuleSchema = z.object({
  /** The word to use. */
  use: nonEmpty,
  /** Words to avoid, and what they wrongly suggest. */
  insteadOf: z.array(nonEmpty).default([]),
  /** What the preferred word names. */
  means: z.string().trim().default(""),
})

export const cardTextFieldSchema = z.object({
  /** The field name a card tool returns. */
  field: nonEmpty,
  /** What that field holds, in one sentence. */
  describes: nonEmpty,
})

/**
 * A printed value on a card, and what it means.
 *
 * A stat reaches the model as a bare name and a number. That is enough while
 * the name explains itself, and it stops being enough exactly where it matters:
 * `price: 70` names no currency, and `rank_value: 14` names no scale. Describe
 * the ones a reader could not work out, and leave the obvious ones alone.
 */
export const cardStatFieldSchema = z.object({
  /** The stat name a card tool returns. */
  field: nonEmpty,
  /** What that value means, in one sentence. Name the unit and the scale. */
  describes: nonEmpty,
})

export const tokenGroupSchema = z.object({
  label: nonEmpty,
  examples: z.array(nonEmpty).min(1),
})

export const profileSchema = z.object({
  game: z.object({
    name: nonEmpty,
    slug: z.string().trim().default(""),
    /** One sentence a reader needs to know what this game is. */
    description: z.string().trim().default(""),
  }),

  /**
   * Overrides the generated identity sentence.
   *
   * Leave it unset unless the generated one reads wrong. A generated identity
   * stays correct when the game is renamed; a written one does not.
   */
  identity: z.string().trim().optional(),

  /** Words this game uses, and words it does not. */
  vocabulary: z.array(vocabularyRuleSchema).default([]),

  cards: z
    .object({
      /** Off when the corpus has no cards. The card tools are not registered. */
      enabled: z.boolean().default(true),
      /**
       * The URL scheme a card link uses, without the colon.
       *
       * The interface turns `[Name](card:path)` into a hover preview. Set it to
       * an empty string to have the model write plain names instead.
       */
      linkScheme: z.string().trim().default("card"),
      /**
       * What this game calls one of its named pieces.
       *
       * The tools are described to the model in words, and "card" is a trading
       * card game's word. A chess assistant offered a tool for "Chess cards" is
       * being told its game has cards, which is the first thing it should not
       * believe. Chess sets "piece", and poker keeps "card".
       */
      noun: z.string().trim().min(1).default("card"),
      /** The plural of `noun`, when adding an "s" gives the wrong word. */
      nounPlural: z.string().trim().default(""),
      /** How many card images one answer may show inline. */
      maxInlineImages: z.number().int().min(0).default(3),
      /** Every text field a card can print, so no answer reads only the first. */
      textFields: z.array(cardTextFieldSchema).default([]),
      /**
       * The printed values a reader could not work out from the name alone.
       *
       * List only those. A described stat costs prompt on every card question,
       * and `price` explained as "the price" teaches the model nothing.
       */
      statFields: z.array(cardStatFieldSchema).default([]),
    })
    .default({}),

  /**
   * Bracket tokens the interface renders as symbols or badges.
   *
   * Unset means the model writes plain words, which is right for a game with no
   * symbols on its cards.
   */
  tokens: z
    .object({
      /** How to write one, for example "[Fury]" or "[Shield 2]". */
      syntax: nonEmpty,
      groups: z.array(tokenGroupSchema).default([]),
    })
    .optional(),

  scope: z
    .object({
      /** Topics to answer. Defaults cover any rulebook. */
      answer: z.array(nonEmpty).default([]),
      /** Topics to decline, beyond the universal ones in the base instructions. */
      refuse: z.array(nonEmpty).default([]),
    })
    .default({}),

  /** Anything else, one paragraph per entry. Appended last. */
  extraGuidance: z.array(nonEmpty).default([]),
})

export type Profile = z.output<typeof profileSchema>
export type ProfileInput = z.input<typeof profileSchema>

/**
 * Read a profile, filling every default.
 *
 * Throws on a profile that names no game, because an assistant that cannot say
 * what it is an assistant for cannot decline anything either.
 */
export function parseProfile(input: unknown): Profile {
  return profileSchema.parse(input)
}

/**
 * What to call one named piece of this game, and several of them.
 *
 * Every sentence the model reads about the card tools is built from these two
 * words. A game that sets neither gets "card" and "cards", which is right for
 * the games the word came from and wrong for chess.
 */
export function pieceNoun(profile: Profile): { one: string; many: string } {
  const one = profile.cards.noun
  return { one, many: profile.cards.nounPlural || `${one}s` }
}

/** A minimal profile, for a corpus with no card data and no symbols. */
export function minimalProfile(name: string, slug = ""): Profile {
  return profileSchema.parse({ game: { name, slug }, cards: { enabled: false } })
}
