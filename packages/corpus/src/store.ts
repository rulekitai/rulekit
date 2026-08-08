import type {
  BanlistEntry,
  Card,
  CardName,
  CardSummary,
  Erratum,
  Game,
  PatchNote,
  Rule,
  RuleBook,
  RuleHit,
  SearchAllResult,
  Section,
  Term,
} from "./types.ts"

/** Paging and scoping options shared by the list reads. */
export type ListOptions = {
  ruleBookId?: string
  sectionId?: string
  limit?: number
  offset?: number
}

export type SearchOptions = {
  limit?: number
  ruleBookId?: string
  /**
   * Include rows a rulebook marks as superseded. Off by default: a deprecated
   * rule quoted as current is a wrong answer, not an incomplete one.
   */
  includeDeprecated?: boolean
}

/**
 * Everything the rules assistant can read.
 *
 * Every method returns a promise even where the shipped stores answer from
 * memory or from a local file. The cost of awaiting a resolved value is nothing,
 * and the alternative bars anybody from backing this with a database or a
 * service of their own without changing every caller.
 *
 * Nothing here writes. A rules assistant reads a corpus and quotes it; a store
 * that can also change it is a store that can be talked into changing it.
 */
export interface RuleStore {
  /** The game this corpus describes. */
  game(): Promise<Game>

  listRuleBooks(): Promise<RuleBook[]>
  listSections(options?: ListOptions): Promise<Section[]>

  getRule(id: string): Promise<Rule | null>
  /**
   * One rule by its printed number.
   *
   * Numbers repeat across rulebooks, so this can be ambiguous. Pass
   * `ruleBookId` when the caller knows which book it means; without it the
   * store returns the match in the first active rulebook, in order.
   */
  getRuleByNumber(ruleNumber: string, options?: { ruleBookId?: string }): Promise<Rule | null>
  getRuleBySlug(slug: string, options?: { ruleBookId?: string }): Promise<Rule | null>
  listRules(options?: ListOptions): Promise<Rule[]>
  searchRules(query: string, options?: SearchOptions): Promise<RuleHit[]>

  getChildren(id: string): Promise<Rule[]>
  getParent(id: string): Promise<Rule | null>
  getSiblings(id: string): Promise<Rule[]>
  /** The rules this one points at, resolved from its cross-references. */
  getRelated(id: string, options?: { limit?: number }): Promise<Rule[]>

  listTerms(options?: { limit?: number; category?: string }): Promise<Term[]>
  getTerm(idOrSlug: string): Promise<Term | null>
  searchTerms(query: string, options?: { limit?: number }): Promise<Term[]>

  listErrata(options?: { cardName?: string; limit?: number }): Promise<Erratum[]>
  listBanlist(options?: { cardName?: string; format?: string; limit?: number }): Promise<BanlistEntry[]>
  listPatchNotes(options?: { category?: string; limit?: number }): Promise<PatchNote[]>
  getPatchNote(slugOrId: string): Promise<PatchNote | null>

  /** Card identities matching a name. Ranked: exact, then prefix, then text. */
  searchCards(query: string, options?: { limit?: number }): Promise<CardSummary[]>
  /** Full cards by id, in the order asked. Ids that match nothing are omitted. */
  getCards(ids: string[]): Promise<Card[]>
  /**
   * Every printed name.
   *
   * This is the proof a card EXISTS, which a legality answer needs before it can
   * say "not banned". A banlist that omits a name says nothing about a name
   * nobody can find, so without this list the honest answer is no answer.
   */
  allCardNames(): Promise<CardName[]>

  /** Rules, terms, errata, banlist, and patch notes in one pass. */
  searchAll(query: string, options?: { limit?: number }): Promise<SearchAllResult>

  /** Release any handle the store holds. Safe to call more than once. */
  close(): Promise<void>
}
