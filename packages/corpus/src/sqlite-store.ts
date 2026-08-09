import { DatabaseSync } from "node:sqlite"
import { buildDatabase, CARD_WEIGHTS, RULE_WEIGHTS, TERM_WEIGHTS } from "./build.ts"
import type { ListOptions, RuleStore, SearchOptions } from "./store.ts"
import { ftsQuery, nameStem, normalizeName, normalizeRuleNumber } from "./text.ts"
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
  SearchAllResult,
  Section,
  Term,
} from "./types.ts"

/** Rows come back from SQLite as plain records of scalars. */
type Row = Record<string, unknown>

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v))
const nul = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null)
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0) || 0)
const flag = (v: unknown): boolean => v === 1 || v === true || v === "1"

function parseList(v: unknown): string[] {
  if (typeof v !== "string") return []
  try {
    const parsed = JSON.parse(v)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

/**
 * Read a field the build wrote as JSON, restoring its original type.
 *
 * The build encodes these fields rather than writing them raw, because a SQLite
 * text column would turn the number 2 into the string "2". Decoding here is the
 * other half of that: without it the SQLite store and the in-memory store
 * disagree about the type of every numeric card field.
 */
function decodeValue(v: unknown): unknown {
  if (typeof v !== "string") return v ?? null
  if (!v) return null
  try {
    return JSON.parse(v)
  } catch {
    // A value written by something other than this builder. Keep it as it is
    // rather than losing it.
    return v
  }
}

function toRule(row: Row): Rule {
  return {
    id: str(row.id),
    rule_book_id: str(row.rule_book_id),
    section_id: nul(row.section_id),
    parent_id: nul(row.parent_id),
    rule_number: str(row.rule_number),
    slug: nul(row.slug),
    title: nul(row.title),
    content: str(row.content),
    example: nul(row.example),
    depth: num(row.depth),
    display_order: num(row.display_order),
    rule_type: str(row.rule_type) || "rule",
    keywords: parseList(row.keywords),
    cross_references: parseList(row.cross_references),
    is_deprecated: flag(row.is_deprecated),
    deprecation_note: nul(row.deprecation_note),
  }
}

const toRuleBook = (row: Row): RuleBook => ({
  id: str(row.id),
  name: str(row.name),
  slug: str(row.slug),
  version: nul(row.version),
  effective_date: nul(row.effective_date),
  is_active: flag(row.is_active),
})

const toSection = (row: Row): Section => ({
  id: str(row.id),
  rule_book_id: str(row.rule_book_id),
  section_number: str(row.section_number),
  title: str(row.title),
  slug: nul(row.slug),
  description: nul(row.description),
  display_order: num(row.display_order),
})

const toTerm = (row: Row): Term => ({
  id: str(row.id),
  term: str(row.term),
  slug: str(row.slug),
  definition: str(row.definition),
  short_definition: nul(row.short_definition),
  category: nul(row.category),
  aliases: parseList(row.aliases),
  defining_rule_id: nul(row.defining_rule_id),
  defining_rule_number: nul(row.defining_rule_number),
})

const toCardRef = (row: Row) =>
  row.card_id || row.card_name
    ? { id: nul(row.card_id), name: nul(row.card_name), png_uri: nul(row.card_png_uri) }
    : null

const toErratum = (row: Row): Erratum => ({
  id: str(row.id),
  card: toCardRef(row),
  effective_date: nul(row.effective_date),
  original_text: nul(row.original_text),
  errata_text: nul(row.errata_text),
  explanation: nul(row.explanation),
  patch_note_slug: nul(row.patch_note_slug),
  patch_note_title: nul(row.patch_note_title),
})

const toBanlistEntry = (row: Row): BanlistEntry => ({
  id: str(row.id),
  card: toCardRef(row),
  format:
    row.format_name || row.format_slug
      ? { id: null, name: nul(row.format_name), slug: nul(row.format_slug) }
      : null,
  entry_type: str(row.entry_type) || "banned",
  effective_date: nul(row.effective_date),
  reason: nul(row.reason),
  patch_note_slug: nul(row.patch_note_slug),
  patch_note_title: nul(row.patch_note_title),
})

const toPatchNote = (row: Row): PatchNote => ({
  id: str(row.id),
  slug: str(row.slug),
  title: str(row.title),
  version: nul(row.version),
  effective_date: nul(row.effective_date),
  category: nul(row.category),
  summary: nul(row.summary),
  body: nul(row.body),
  affected_rule_ids: parseList(row.affected_rule_ids),
  affected_card_ids: parseList(row.affected_card_ids),
})

/** A stored map, back as a map. Anything that is not one reads as empty rather than throwing. */
const toMap = <T>(v: unknown): Record<string, T> => {
  const decoded = decodeValue(v)
  return decoded && typeof decoded === "object" && !Array.isArray(decoded)
    ? (decoded as Record<string, T>)
    : {}
}

const toCard = (row: Row): Card => ({
  id: str(row.id),
  name: str(row.name),
  type_line: nul(row.type_line),
  rarity: nul(row.rarity),
  set_name: nul(row.set_name),
  png_uri: nul(row.png_uri),
  tags: (decodeValue(row.tags) as string[]) ?? [],
  text: toMap<string>(row.text),
  stats: toMap<unknown>(row.stats),
})

const toCardSummary = (row: Row): CardSummary => ({
  id: str(row.id),
  name: str(row.name),
  type_line: nul(row.type_line),
  png_uri: nul(row.png_uri),
})

const DEFAULT_LIMIT = 20
const clampLimit = (value: number | undefined, fallback = DEFAULT_LIMIT) =>
  Math.max(1, Math.min(200, Math.trunc(value ?? fallback)))

/** A placeholder list for an IN clause, e.g. "?,?,?". */
const placeholders = (count: number) => new Array(count).fill("?").join(",")

/**
 * The corpus, read from a SQLite file.
 *
 * Every read is a local query. Nothing here opens a socket, so the assistant
 * cannot be slower than a disk read and cannot be down because something else
 * is down.
 */
export class SqliteStore implements RuleStore {
  #db: DatabaseSync
  #closed = false

  private constructor(db: DatabaseSync) {
    this.#db = db
  }

  /** Open a built database. Read-only, so two processes can share one file. */
  static open(path: string): SqliteStore {
    return new SqliteStore(new DatabaseSync(path, { readOnly: true }))
  }

  /** Build a database in memory from a corpus. This is what the tests use. */
  static fromCorpus(corpus: Corpus): SqliteStore {
    return new SqliteStore(buildDatabase(corpus, { path: ":memory:" }))
  }

  #all(sql: string, ...params: (string | number | null)[]): Row[] {
    return this.#db.prepare(sql).all(...params) as Row[]
  }

  #get(sql: string, ...params: (string | number | null)[]): Row | null {
    return (this.#db.prepare(sql).get(...params) as Row | undefined) ?? null
  }

  async game(): Promise<Game> {
    const rows = this.#all("SELECT key, value FROM meta")
    const map = new Map(rows.map((r) => [str(r.key), str(r.value)]))
    return { slug: map.get("game_slug") ?? "", name: map.get("game_name") ?? "" }
  }

  async listRuleBooks(): Promise<RuleBook[]> {
    return this.#all("SELECT * FROM rulebooks ORDER BY position").map(toRuleBook)
  }

  async listSections(options: ListOptions = {}): Promise<Section[]> {
    const where = options.ruleBookId ? "WHERE rule_book_id = ?" : ""
    const params = options.ruleBookId ? [options.ruleBookId] : []
    return this.#all(
      `SELECT * FROM sections ${where} ORDER BY display_order, section_number LIMIT ?`,
      ...params,
      clampLimit(options.limit, 200),
    ).map(toSection)
  }

  async getRule(id: string): Promise<Rule | null> {
    const row = this.#get("SELECT * FROM rules WHERE id = ?", id)
    return row ? toRule(row) : null
  }

  async getRuleByNumber(ruleNumber: string, options: { ruleBookId?: string } = {}): Promise<Rule | null> {
    const key = normalizeRuleNumber(ruleNumber)
    if (options.ruleBookId) {
      const row = this.#get(
        "SELECT * FROM rules WHERE rule_number_key = ? AND rule_book_id = ?",
        key,
        options.ruleBookId,
      )
      return row ? toRule(row) : null
    }
    // Numbers repeat across rulebooks. Ordering by the rulebook's own position
    // makes the choice stable and puts the primary book first, rather than
    // handing back whichever row the storage engine reached first.
    const row = this.#get(
      `SELECT r.* FROM rules r JOIN rulebooks b ON b.id = r.rule_book_id
       WHERE r.rule_number_key = ? ORDER BY b.is_active DESC, b.position LIMIT 1`,
      key,
    )
    return row ? toRule(row) : null
  }

  async getRuleBySlug(slug: string, options: { ruleBookId?: string } = {}): Promise<Rule | null> {
    if (options.ruleBookId) {
      const row = this.#get(
        "SELECT * FROM rules WHERE slug = ? AND rule_book_id = ?",
        slug,
        options.ruleBookId,
      )
      return row ? toRule(row) : null
    }
    const row = this.#get(
      `SELECT r.* FROM rules r JOIN rulebooks b ON b.id = r.rule_book_id
       WHERE r.slug = ? ORDER BY b.is_active DESC, b.position LIMIT 1`,
      slug,
    )
    return row ? toRule(row) : null
  }

  async listRules(options: ListOptions = {}): Promise<Rule[]> {
    const clauses: string[] = []
    const params: (string | number)[] = []
    if (options.ruleBookId) {
      clauses.push("rule_book_id = ?")
      params.push(options.ruleBookId)
    }
    if (options.sectionId) {
      clauses.push("section_id = ?")
      params.push(options.sectionId)
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
    return this.#all(
      `SELECT * FROM rules ${where} ORDER BY display_order, rule_number LIMIT ? OFFSET ?`,
      ...params,
      clampLimit(options.limit, 50),
      Math.max(0, Math.trunc(options.offset ?? 0)),
    ).map(toRule)
  }

  async searchRules(query: string, options: SearchOptions = {}): Promise<RuleHit[]> {
    const match = ftsQuery(query)
    // A question with nothing searchable in it matches nothing. It must never
    // fall through to "return everything", which is how a ranked list of
    // irrelevant rules ends up looking like an answer.
    if (!match) return []

    const clauses = ["rules_fts MATCH ?"]
    const params: (string | number)[] = [match]
    if (options.ruleBookId) {
      clauses.push("r.rule_book_id = ?")
      params.push(options.ruleBookId)
    }
    if (!options.includeDeprecated) clauses.push("r.is_deprecated = 0")
    // A section header carries no text of its own, so it can only match on its
    // title and would otherwise crowd out the rules underneath it.
    clauses.push("r.content != ''")

    const rows = this.#all(
      `SELECT r.*, bm25(rules_fts, ${RULE_WEIGHTS.number}, ${RULE_WEIGHTS.title}, ${RULE_WEIGHTS.content}, ${RULE_WEIGHTS.example}) AS bm
       FROM rules_fts JOIN rules r ON r.id = rules_fts.rule_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY bm LIMIT ?`,
      ...params,
      clampLimit(options.limit),
    )
    // SQLite's bm25 is more negative for a better match. Flipping the sign here
    // means every caller can read "higher is better" and sort naturally.
    return rows.map((row) => ({ ...toRule(row), score: -num(row.bm) }))
  }

  async getChildren(id: string): Promise<Rule[]> {
    return this.#all("SELECT * FROM rules WHERE parent_id = ? ORDER BY display_order, rule_number", id).map(
      toRule,
    )
  }

  async getParent(id: string): Promise<Rule | null> {
    const row = this.#get("SELECT p.* FROM rules r JOIN rules p ON p.id = r.parent_id WHERE r.id = ?", id)
    return row ? toRule(row) : null
  }

  async getSiblings(id: string): Promise<Rule[]> {
    const self = this.#get("SELECT parent_id, rule_book_id FROM rules WHERE id = ?", id)
    if (!self) return []
    // A top-level rule has no parent, so its siblings are the other top-level
    // rules of the same book. Matching on a NULL parent needs IS NULL; `= NULL`
    // is never true and would return an empty list for every root rule.
    const where = self.parent_id
      ? "parent_id = ? AND id != ?"
      : "parent_id IS NULL AND rule_book_id = ? AND id != ?"
    const key = self.parent_id ? str(self.parent_id) : str(self.rule_book_id)
    return this.#all(`SELECT * FROM rules WHERE ${where} ORDER BY display_order, rule_number`, key, id).map(
      toRule,
    )
  }

  async getRelated(id: string, options: { limit?: number } = {}): Promise<Rule[]> {
    const self = await this.getRule(id)
    if (!self?.cross_references.length) return []
    const keys = self.cross_references.map(normalizeRuleNumber).filter(Boolean)
    if (!keys.length) return []
    // Resolve inside the same rulebook first. A cross-reference is written in
    // one book's numbering, and following it into another book's identically
    // numbered rule would answer with text the reference never pointed at.
    const rows = this.#all(
      `SELECT * FROM rules WHERE rule_number_key IN (${placeholders(keys.length)})
       AND rule_book_id = ? AND id != ? ORDER BY display_order LIMIT ?`,
      ...keys,
      self.rule_book_id,
      id,
      clampLimit(options.limit, 10),
    )
    return rows.map(toRule)
  }

  async listTerms(options: { limit?: number; category?: string } = {}): Promise<Term[]> {
    const where = options.category ? "WHERE category = ?" : ""
    const params = options.category ? [options.category] : []
    return this.#all(
      `SELECT * FROM terms ${where} ORDER BY term LIMIT ?`,
      ...params,
      clampLimit(options.limit, 200),
    ).map(toTerm)
  }

  async getTerm(idOrSlug: string): Promise<Term | null> {
    const key = normalizeName(idOrSlug)
    const row =
      this.#get("SELECT * FROM terms WHERE id = ? OR slug = ?", idOrSlug, idOrSlug) ??
      // An alias reaches the same term. A reader who types a printed synonym
      // must land on the definition, not on nothing.
      this.#get(
        "SELECT t.* FROM term_aliases a JOIN terms t ON t.id = a.term_id WHERE a.alias_key = ? LIMIT 1",
        key,
      )
    return row ? toTerm(row) : null
  }

  async searchTerms(query: string, options: { limit?: number } = {}): Promise<Term[]> {
    const limit = clampLimit(options.limit, 10)
    // An exact name or alias is the answer, not a candidate. Ranking it against
    // every definition that happens to mention the word buries it.
    const exact = this.#all(
      "SELECT t.* FROM term_aliases a JOIN terms t ON t.id = a.term_id WHERE a.alias_key = ? LIMIT ?",
      normalizeName(query),
      limit,
    )
    if (exact.length) return exact.map(toTerm)

    const match = ftsQuery(query)
    if (!match) return []
    return this.#all(
      `SELECT t.*, bm25(terms_fts, ${TERM_WEIGHTS.term}, ${TERM_WEIGHTS.aliases}, ${TERM_WEIGHTS.definition}) AS bm
       FROM terms_fts JOIN terms t ON t.id = terms_fts.term_id
       WHERE terms_fts MATCH ? ORDER BY bm LIMIT ?`,
      match,
      limit,
    ).map(toTerm)
  }

  async listErrata(options: { cardName?: string; limit?: number } = {}): Promise<Erratum[]> {
    const where = options.cardName ? "WHERE card_key = ?" : ""
    const params = options.cardName ? [normalizeName(options.cardName)] : []
    return this.#all(
      `SELECT * FROM errata ${where} ORDER BY effective_date DESC, card_name LIMIT ?`,
      ...params,
      clampLimit(options.limit, 200),
    ).map(toErratum)
  }

  async listBanlist(
    options: { cardName?: string; format?: string; limit?: number } = {},
  ): Promise<BanlistEntry[]> {
    const clauses: string[] = []
    const params: string[] = []
    if (options.cardName) {
      clauses.push("card_key = ?")
      params.push(normalizeName(options.cardName))
    }
    if (options.format) {
      clauses.push("(format_slug = ? OR format_name = ?)")
      params.push(options.format, options.format)
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
    return this.#all(
      `SELECT * FROM banlist ${where} ORDER BY effective_date DESC, card_name LIMIT ?`,
      ...params,
      clampLimit(options.limit, 200),
    ).map(toBanlistEntry)
  }

  async listPatchNotes(options: { category?: string; limit?: number } = {}): Promise<PatchNote[]> {
    const where = options.category ? "WHERE category = ?" : ""
    const params = options.category ? [options.category] : []
    return this.#all(
      `SELECT * FROM patch_notes ${where} ORDER BY effective_date DESC LIMIT ?`,
      ...params,
      clampLimit(options.limit, 50),
    ).map(toPatchNote)
  }

  async getPatchNote(slugOrId: string): Promise<PatchNote | null> {
    const row = this.#get("SELECT * FROM patch_notes WHERE slug = ? OR id = ?", slugOrId, slugOrId)
    return row ? toPatchNote(row) : null
  }

  async searchCards(query: string, options: { limit?: number } = {}): Promise<CardSummary[]> {
    const limit = clampLimit(options.limit, 8)
    const key = normalizeName(query)
    if (!key) return []
    const found = new Map<string, CardSummary>()
    const take = (rows: Row[]) => {
      for (const row of rows) {
        if (found.size >= limit) return
        const card = toCardSummary(row)
        if (!found.has(card.id)) found.set(card.id, card)
      }
    }

    // Most literal first. A reader who types a whole printed name must get that
    // card, never a ranked list that happens to put it second.
    take(this.#all("SELECT * FROM cards WHERE name_key = ? LIMIT ?", key, limit))
    // Then every printing filed under the name. A reader who types a character
    // name means all of its printings, and only the stem reaches them.
    if (found.size < limit)
      take(this.#all("SELECT * FROM cards WHERE name_stem = ? ORDER BY name LIMIT ?", key, limit))
    // Then a leading-run match, which is what an unfinished name looks like.
    if (found.size < limit)
      take(this.#all("SELECT * FROM cards WHERE name_key LIKE ? ORDER BY name LIMIT ?", `${key}%`, limit))
    if (found.size < limit) {
      const stem = nameStem(query)
      if (stem && stem !== key)
        take(this.#all("SELECT * FROM cards WHERE name_stem = ? ORDER BY name LIMIT ?", stem, limit))
    }
    // Last, the text index, which finds a card the reader described instead of
    // named.
    if (found.size < limit) {
      const match = ftsQuery(query)
      if (match) {
        take(
          this.#all(
            `SELECT c.*, bm25(cards_fts, ${CARD_WEIGHTS.name}, ${CARD_WEIGHTS.type}, ${CARD_WEIGHTS.text}) AS bm
             FROM cards_fts JOIN cards c ON c.id = cards_fts.card_id
             WHERE cards_fts MATCH ? ORDER BY bm LIMIT ?`,
            match,
            limit,
          ),
        )
      }
    }
    return [...found.values()]
  }

  async getCards(ids: string[]): Promise<Card[]> {
    const wanted = ids.filter((id) => typeof id === "string" && id).slice(0, 200)
    if (!wanted.length) return []
    const rows = this.#all(`SELECT * FROM cards WHERE id IN (${placeholders(wanted.length)})`, ...wanted)
    const byId = new Map(rows.map((row) => [str(row.id), toCard(row)]))
    // Answer in the order asked, and omit an id that matched nothing rather
    // than returning a hole the caller has to check for.
    return wanted.map((id) => byId.get(id)).filter((card): card is Card => Boolean(card))
  }

  async allCardNames(): Promise<CardName[]> {
    return this.#all("SELECT id, name, png_uri FROM cards ORDER BY name").map((row) => ({
      id: str(row.id),
      name: str(row.name),
      png_uri: nul(row.png_uri),
    }))
  }

  async searchAll(query: string, options: { limit?: number } = {}): Promise<SearchAllResult> {
    const limit = clampLimit(options.limit, 8)
    const match = ftsQuery(query)
    const key = normalizeName(query)

    const [rules, terms] = await Promise.all([
      this.searchRules(query, { limit }),
      this.searchTerms(query, { limit: Math.min(limit, 5) }),
    ])

    // Errata and banlist rows are keyed by card, so a name reaches them
    // directly. The text index would rank a card mentioned in a reason above
    // the card the reader asked about.
    const stem = nameStem(query)
    const cardKeys = [...new Set([key, stem].filter(Boolean))]
    const cardWhere = `card_key IN (${placeholders(cardKeys.length)})`
    const errata = cardKeys.length
      ? this.#all(`SELECT * FROM errata WHERE ${cardWhere} LIMIT ?`, ...cardKeys, limit).map(toErratum)
      : []
    const banlist = cardKeys.length
      ? this.#all(`SELECT * FROM banlist WHERE ${cardWhere} LIMIT ?`, ...cardKeys, limit).map(toBanlistEntry)
      : []

    const patchNotes = match
      ? this.#all(
          `SELECT n.* FROM notes_fts JOIN patch_notes n ON n.id = notes_fts.note_id
           WHERE notes_fts MATCH ? ORDER BY bm25(notes_fts, 4.0, 2.0, 1.0) LIMIT ?`,
          match,
          Math.min(limit, 5),
        ).map(toPatchNote)
      : []

    return { rules, terms, errata, banlist, patchNotes }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.#db.close()
  }
}
