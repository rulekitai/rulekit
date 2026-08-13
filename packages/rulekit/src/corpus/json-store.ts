import { Bm25Index } from "./bm25.ts"
import type { ListOptions, RuleStore, RulingListOptions, SearchOptions } from "./store.ts"
import { nameStem, normalizeName, normalizeRuleNumber } from "./text.ts"
import type {
  BanlistEntry,
  Card,
  CardName,
  CardSummary,
  Corpus,
  Erratum,
  Game,
  PatchNote,
  Rule,
  RuleBook,
  RuleHit,
  Ruling,
  SearchAllResult,
  Section,
  Term,
} from "./types.ts"

const clampLimit = (value: number | undefined, fallback = 20) =>
  Math.max(1, Math.min(200, Math.trunc(value ?? fallback)))

/** Group rows into a lookup keyed by a folded string. */
function groupBy<T>(rows: T[], key: (row: T) => string | null): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const k = key(row)
    if (!k) continue
    const found = out.get(k)
    if (found) found.push(row)
    else out.set(k, [row])
  }
  return out
}

/**
 * The corpus, held in memory.
 *
 * This is the store for a runtime with no filesystem and no SQLite, such as an
 * edge function. It answers exactly what the SQLite store answers and ranks with
 * the same family of scoring, so a caller can swap one for the other.
 *
 * The cost is memory: the whole corpus and its index stay resident. For a few
 * thousand rules and a thousand cards that is tens of megabytes. Prefer the
 * SQLite store anywhere a file is available.
 */
export class JsonStore implements RuleStore {
  #corpus: Corpus
  #rulesById: Map<string, Rule>
  #rulesByNumber: Map<string, Rule[]>
  #rulesBySlug: Map<string, Rule[]>
  #childrenByParent: Map<string, Rule[]>
  #bookPosition: Map<string, number>
  #termsByAlias: Map<string, Term>
  #cardsById: Map<string, Card>
  #cardsByName: Map<string, Card[]>
  #cardsByStem: Map<string, Card[]>
  #errataByCard: Map<string, Erratum[]>
  #banlistByCard: Map<string, BanlistEntry[]>
  #rulingsByCard: Map<string, Ruling[]>
  #ruleIndex: Bm25Index<Rule>
  #termIndex: Bm25Index<Term>
  #cardIndex: Bm25Index<Card>
  #noteIndex: Bm25Index<PatchNote>
  #rulingIndex: Bm25Index<Ruling>

  constructor(corpus: Corpus) {
    this.#corpus = corpus
    this.#rulesById = new Map(corpus.rules.map((r) => [r.id, r]))
    this.#rulesByNumber = groupBy(corpus.rules, (r) => normalizeRuleNumber(r.rule_number))
    this.#rulesBySlug = groupBy(corpus.rules, (r) => r.slug)
    this.#childrenByParent = groupBy(corpus.rules, (r) => r.parent_id)
    this.#bookPosition = new Map(corpus.rulebooks.map((b, index) => [b.id, index]))

    this.#termsByAlias = new Map()
    for (const term of corpus.terms) {
      // The term's own name is an alias of itself, so one map answers both a
      // printed name and any synonym the corpus lists.
      for (const alias of [term.term, ...term.aliases]) {
        const key = normalizeName(alias)
        if (key && !this.#termsByAlias.has(key)) this.#termsByAlias.set(key, term)
      }
    }

    this.#cardsById = new Map(corpus.cards.map((c) => [c.id, c]))
    this.#cardsByName = groupBy(corpus.cards, (c) => normalizeName(c.name))
    this.#cardsByStem = groupBy(corpus.cards, (c) => nameStem(c.name))
    this.#errataByCard = groupBy(corpus.errata, (e) => (e.card?.name ? normalizeName(e.card.name) : null))
    this.#banlistByCard = groupBy(corpus.banlist, (b) => (b.card?.name ? normalizeName(b.card.name) : null))

    // A ruling files under every piece it names, which is why `groupBy` cannot
    // build this map: `groupBy` takes one key per row, and a ruling explaining
    // what happens when two pieces meet has to be found from either of them.
    this.#rulingsByCard = new Map()
    for (const ruling of corpus.rulings) {
      for (const card of ruling.cards) {
        const key = card.name ? normalizeName(card.name) : null
        if (!key) continue
        const found = this.#rulingsByCard.get(key)
        if (found) found.push(ruling)
        else this.#rulingsByCard.set(key, [ruling])
      }
    }

    // Deprecated rules and bare section headers stay out of the index, for the
    // same two reasons the SQLite build leaves them out: superseded text must
    // not answer a current question, and a header has no body to quote.
    const searchable = corpus.rules.filter((r) => !r.is_deprecated && r.content !== "")
    this.#ruleIndex = new Bm25Index(searchable, (r) => [
      { text: r.rule_number, weight: 8 },
      { text: r.title ?? "", weight: 3 },
      { text: r.content, weight: 1 },
      { text: r.example ?? "", weight: 0.5 },
    ])
    this.#termIndex = new Bm25Index(corpus.terms, (t) => [
      { text: t.term, weight: 8 },
      { text: t.aliases.join(" "), weight: 4 },
      { text: t.definition, weight: 1 },
    ])
    this.#cardIndex = new Bm25Index(corpus.cards, (c) => [
      { text: c.name, weight: 8 },
      { text: c.type_line ?? "", weight: 1 },
      { text: Object.values(c.text).join("\n"), weight: 2 },
    ])
    this.#noteIndex = new Bm25Index(corpus.patchNotes, (n) => [
      { text: n.title, weight: 4 },
      { text: n.summary ?? "", weight: 2 },
      { text: n.body ?? "", weight: 1 },
    ])
    // The same four weights the SQLite build uses, so both stores rank a set of
    // rulings the same way and a caller can swap one for the other.
    this.#rulingIndex = new Bm25Index(
      corpus.rulings.filter((r) => !r.is_deprecated),
      (r) => [
        { text: r.question, weight: 8 },
        {
          text: r.cards
            .map((c) => c.name)
            .filter(Boolean)
            .join(" "),
          weight: 4,
        },
        { text: r.topic ?? "", weight: 3 },
        { text: r.answer, weight: 1 },
      ],
    )
  }

  /** Order candidates so the primary rulebook wins a repeated number. */
  #preferPrimary(rules: Rule[]): Rule[] {
    return [...rules].sort(
      (a, b) => (this.#bookPosition.get(a.rule_book_id) ?? 0) - (this.#bookPosition.get(b.rule_book_id) ?? 0),
    )
  }

  async game(): Promise<Game> {
    return this.#corpus.game
  }

  async listRuleBooks(): Promise<RuleBook[]> {
    return this.#corpus.rulebooks
  }

  async listSections(options: ListOptions = {}): Promise<Section[]> {
    return this.#corpus.sections
      .filter((s) => !options.ruleBookId || s.rule_book_id === options.ruleBookId)
      .sort((a, b) => a.display_order - b.display_order || a.section_number.localeCompare(b.section_number))
      .slice(0, clampLimit(options.limit, 200))
  }

  async getRule(id: string): Promise<Rule | null> {
    return this.#rulesById.get(id) ?? null
  }

  async getRuleByNumber(ruleNumber: string, options: { ruleBookId?: string } = {}): Promise<Rule | null> {
    const found = this.#rulesByNumber.get(normalizeRuleNumber(ruleNumber)) ?? []
    if (options.ruleBookId) return found.find((r) => r.rule_book_id === options.ruleBookId) ?? null
    return this.#preferPrimary(found)[0] ?? null
  }

  async getRuleBySlug(slug: string, options: { ruleBookId?: string } = {}): Promise<Rule | null> {
    const found = this.#rulesBySlug.get(slug) ?? []
    if (options.ruleBookId) return found.find((r) => r.rule_book_id === options.ruleBookId) ?? null
    return this.#preferPrimary(found)[0] ?? null
  }

  async listRules(options: ListOptions = {}): Promise<Rule[]> {
    const offset = Math.max(0, Math.trunc(options.offset ?? 0))
    return this.#corpus.rules
      .filter((r) => !options.ruleBookId || r.rule_book_id === options.ruleBookId)
      .filter((r) => !options.sectionId || r.section_id === options.sectionId)
      .sort((a, b) => a.display_order - b.display_order || a.rule_number.localeCompare(b.rule_number))
      .slice(offset, offset + clampLimit(options.limit, 50))
  }

  async searchRules(query: string, options: SearchOptions = {}): Promise<RuleHit[]> {
    const limit = clampLimit(options.limit)
    // Ask for more than requested, because the rulebook filter below removes
    // matches after ranking and would otherwise return a short list.
    const hits = this.#ruleIndex.search(query, options.ruleBookId ? limit * 4 : limit)
    return hits
      .filter(({ item }) => !options.ruleBookId || item.rule_book_id === options.ruleBookId)
      .slice(0, limit)
      .map(({ item, score }) => ({ ...item, score }))
  }

  async getChildren(id: string): Promise<Rule[]> {
    return [...(this.#childrenByParent.get(id) ?? [])].sort(
      (a, b) => a.display_order - b.display_order || a.rule_number.localeCompare(b.rule_number),
    )
  }

  async getParent(id: string): Promise<Rule | null> {
    const self = this.#rulesById.get(id)
    return self?.parent_id ? (this.#rulesById.get(self.parent_id) ?? null) : null
  }

  async getSiblings(id: string): Promise<Rule[]> {
    const self = this.#rulesById.get(id)
    if (!self) return []
    const family = self.parent_id
      ? (this.#childrenByParent.get(self.parent_id) ?? [])
      : this.#corpus.rules.filter((r) => !r.parent_id && r.rule_book_id === self.rule_book_id)
    return family
      .filter((r) => r.id !== id)
      .sort((a, b) => a.display_order - b.display_order || a.rule_number.localeCompare(b.rule_number))
  }

  async getRelated(id: string, options: { limit?: number } = {}): Promise<Rule[]> {
    const self = this.#rulesById.get(id)
    if (!self) return []
    const out: Rule[] = []
    for (const reference of self.cross_references) {
      const candidates = this.#rulesByNumber.get(normalizeRuleNumber(reference)) ?? []
      // Stay inside the rule's own book. A cross-reference is written in one
      // book's numbering, and the same number elsewhere is a different rule.
      const found = candidates.find((r) => r.rule_book_id === self.rule_book_id && r.id !== id)
      if (found && !out.some((r) => r.id === found.id)) out.push(found)
      if (out.length >= clampLimit(options.limit, 10)) break
    }
    return out
  }

  async listTerms(options: { limit?: number; category?: string } = {}): Promise<Term[]> {
    return this.#corpus.terms
      .filter((t) => !options.category || t.category === options.category)
      .sort((a, b) => a.term.localeCompare(b.term))
      .slice(0, clampLimit(options.limit, 200))
  }

  async getTerm(idOrSlug: string): Promise<Term | null> {
    return (
      this.#corpus.terms.find((t) => t.id === idOrSlug || t.slug === idOrSlug) ??
      this.#termsByAlias.get(normalizeName(idOrSlug)) ??
      null
    )
  }

  async searchTerms(query: string, options: { limit?: number } = {}): Promise<Term[]> {
    const limit = clampLimit(options.limit, 10)
    const exact = this.#termsByAlias.get(normalizeName(query))
    if (exact) return [exact]
    return this.#termIndex.search(query, limit).map(({ item }) => item)
  }

  async listErrata(options: { cardName?: string; limit?: number } = {}): Promise<Erratum[]> {
    const rows = options.cardName
      ? (this.#errataByCard.get(normalizeName(options.cardName)) ?? [])
      : this.#corpus.errata
    return rows.slice(0, clampLimit(options.limit, 200))
  }

  async listBanlist(
    options: { cardName?: string; format?: string; limit?: number } = {},
  ): Promise<BanlistEntry[]> {
    let rows = options.cardName
      ? (this.#banlistByCard.get(normalizeName(options.cardName)) ?? [])
      : this.#corpus.banlist
    if (options.format)
      rows = rows.filter((b) => b.format?.slug === options.format || b.format?.name === options.format)
    return rows.slice(0, clampLimit(options.limit, 200))
  }

  async listPatchNotes(options: { category?: string; limit?: number } = {}): Promise<PatchNote[]> {
    return this.#corpus.patchNotes
      .filter((n) => !options.category || n.category === options.category)
      .sort((a, b) => (b.effective_date ?? "").localeCompare(a.effective_date ?? ""))
      .slice(0, clampLimit(options.limit, 50))
  }

  async getPatchNote(slugOrId: string): Promise<PatchNote | null> {
    return this.#corpus.patchNotes.find((n) => n.slug === slugOrId || n.id === slugOrId) ?? null
  }

  async listRulings(options: RulingListOptions = {}): Promise<Ruling[]> {
    let rows = options.cardName
      ? (this.#rulingsByCard.get(normalizeName(options.cardName)) ?? [])
      : this.#corpus.rulings
    if (options.kind) rows = rows.filter((r) => r.kind === options.kind)
    if (options.topic) {
      const key = normalizeName(options.topic)
      rows = rows.filter((r) => (r.topic ? normalizeName(r.topic) === key : false))
    }
    // Superseded rulings sort last rather than vanishing, as in the SQLite store.
    return [...rows]
      .sort((a, b) => Number(a.is_deprecated) - Number(b.is_deprecated))
      .slice(0, clampLimit(options.limit, 200))
  }

  async searchRulings(query: string, options: { limit?: number } = {}): Promise<Ruling[]> {
    return this.#rulingIndex.search(query, clampLimit(options.limit, 8)).map(({ item }) => item)
  }

  async searchCards(query: string, options: { limit?: number } = {}): Promise<CardSummary[]> {
    const limit = clampLimit(options.limit, 8)
    const key = normalizeName(query)
    if (!key) return []
    const found = new Map<string, CardSummary>()
    const take = (cards: Card[]) => {
      for (const card of cards) {
        if (found.size >= limit) return
        if (!found.has(card.id))
          found.set(card.id, {
            id: card.id,
            name: card.name,
            type_line: card.type_line,
            png_uri: card.png_uri,
          })
      }
    }

    // Same order as the SQLite store, for the same reason: the most literal
    // reading of what the reader typed wins before any ranking runs.
    take(this.#cardsByName.get(key) ?? [])
    if (found.size < limit) take(this.#cardsByStem.get(key) ?? [])
    if (found.size < limit)
      take(this.#corpus.cards.filter((c) => normalizeName(c.name).startsWith(`${key} `)))
    if (found.size < limit) {
      const stem = nameStem(query)
      if (stem && stem !== key) take(this.#cardsByStem.get(stem) ?? [])
    }
    if (found.size < limit) take(this.#cardIndex.search(query, limit).map(({ item }) => item))
    return [...found.values()]
  }

  async getCards(ids: string[]): Promise<Card[]> {
    return ids
      .slice(0, 200)
      .map((id) => this.#cardsById.get(id))
      .filter((card): card is Card => Boolean(card))
  }

  async allCardNames(): Promise<CardName[]> {
    return this.#corpus.cards
      .map((c) => ({ id: c.id, name: c.name, png_uri: c.png_uri }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async searchAll(query: string, options: { limit?: number } = {}): Promise<SearchAllResult> {
    const limit = clampLimit(options.limit, 8)
    const keys = [...new Set([normalizeName(query), nameStem(query)].filter(Boolean))]

    // Exact names first, then the ranked questions, as in the SQLite store. A
    // reader who names a piece wants every ruling about it; a reader who
    // describes a situation wants the closest question.
    const named = keys.flatMap((k) => this.#rulingsByCard.get(k) ?? [])
    const rulings = [...new Map(named.map((r) => [r.id, r])).values()].slice(0, limit)
    const seen = new Set(rulings.map((r) => r.id))
    for (const found of await this.searchRulings(query, { limit })) {
      if (rulings.length >= limit) break
      if (!seen.has(found.id)) rulings.push(found)
    }

    return {
      rules: await this.searchRules(query, { limit }),
      terms: await this.searchTerms(query, { limit: Math.min(limit, 5) }),
      errata: keys.flatMap((k) => this.#errataByCard.get(k) ?? []).slice(0, limit),
      banlist: keys.flatMap((k) => this.#banlistByCard.get(k) ?? []).slice(0, limit),
      patchNotes: this.#noteIndex.search(query, Math.min(limit, 5)).map(({ item }) => item),
      rulings,
    }
  }

  async close(): Promise<void> {
    // Nothing to release. Present so a caller can treat both stores alike.
  }
}
