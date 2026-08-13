import { rmSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { nameStem, normalizeName } from "./text.ts"
import type { Corpus } from "./types.ts"

/**
 * Compile a corpus into a single SQLite file.
 *
 * SQLite comes with Node, so this needs no native module, no compiler on the
 * machine, and no install step that can fail. Full-text search comes with it
 * too, which is why searching a rulebook here costs nothing to set up.
 *
 * The whole build runs inside one transaction. A build that fails half way
 * leaves no file a reader could mistake for a complete one.
 */

/** Column weights for rule ranking, highest first. */
const RULE_WEIGHTS = { number: 8.0, title: 3.0, content: 1.0, example: 0.5 }
const CARD_WEIGHTS = { name: 8.0, type: 1.0, text: 2.0 }
const TERM_WEIGHTS = { term: 8.0, aliases: 4.0, definition: 1.0 }
/**
 * A ruling is found by its question far more often than by its answer.
 *
 * A reader asks nearly the words somebody already asked, so the question column
 * carries the match. The answer is long and repeats common rules vocabulary, so
 * weighting it highly would rank every ruling about a popular mechanic above the
 * one ruling that answers the question in front of you.
 */
const RULING_WEIGHTS = { question: 8.0, cards: 4.0, topic: 3.0, answer: 1.0 }

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE rulebooks (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL,
  version TEXT, effective_date TEXT, is_active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sections (
  id TEXT PRIMARY KEY, rule_book_id TEXT NOT NULL, section_number TEXT NOT NULL,
  title TEXT NOT NULL, slug TEXT, description TEXT, display_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX sections_book ON sections(rule_book_id, display_order);

CREATE TABLE rules (
  id TEXT PRIMARY KEY, rule_book_id TEXT NOT NULL, section_id TEXT, parent_id TEXT,
  rule_number TEXT NOT NULL, rule_number_key TEXT NOT NULL, slug TEXT,
  title TEXT, content TEXT NOT NULL, example TEXT,
  depth INTEGER NOT NULL DEFAULT 0, display_order INTEGER NOT NULL DEFAULT 0,
  rule_type TEXT NOT NULL DEFAULT 'rule',
  keywords TEXT NOT NULL DEFAULT '[]', cross_references TEXT NOT NULL DEFAULT '[]',
  is_deprecated INTEGER NOT NULL DEFAULT 0, deprecation_note TEXT
);
CREATE INDEX rules_number ON rules(rule_number_key);
CREATE INDEX rules_slug ON rules(slug);
CREATE INDEX rules_parent ON rules(parent_id, display_order);
CREATE INDEX rules_section ON rules(section_id, display_order);
CREATE INDEX rules_book ON rules(rule_book_id, display_order);

CREATE TABLE terms (
  id TEXT PRIMARY KEY, term TEXT NOT NULL, term_key TEXT NOT NULL, slug TEXT,
  definition TEXT NOT NULL, short_definition TEXT, category TEXT,
  aliases TEXT NOT NULL DEFAULT '[]',
  defining_rule_id TEXT, defining_rule_number TEXT
);
CREATE INDEX terms_key ON terms(term_key);
CREATE INDEX terms_slug ON terms(slug);

CREATE TABLE term_aliases (term_id TEXT NOT NULL, alias_key TEXT NOT NULL);
CREATE INDEX term_aliases_key ON term_aliases(alias_key);

CREATE TABLE errata (
  id TEXT PRIMARY KEY, card_id TEXT, card_name TEXT, card_key TEXT, card_png_uri TEXT,
  effective_date TEXT, original_text TEXT, errata_text TEXT, explanation TEXT,
  patch_note_slug TEXT, patch_note_title TEXT
);
CREATE INDEX errata_card ON errata(card_key);

CREATE TABLE banlist (
  id TEXT PRIMARY KEY, card_id TEXT, card_name TEXT, card_key TEXT, card_png_uri TEXT,
  format_name TEXT, format_slug TEXT, entry_type TEXT NOT NULL,
  effective_date TEXT, reason TEXT, patch_note_slug TEXT, patch_note_title TEXT
);
CREATE INDEX banlist_card ON banlist(card_key);

CREATE TABLE patch_notes (
  id TEXT PRIMARY KEY, slug TEXT, title TEXT NOT NULL, version TEXT,
  effective_date TEXT, category TEXT, summary TEXT, body TEXT,
  affected_rule_ids TEXT NOT NULL DEFAULT '[]', affected_card_ids TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX patch_notes_slug ON patch_notes(slug);

CREATE TABLE cards (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL, name_stem TEXT NOT NULL,
  type_line TEXT, rarity TEXT, set_name TEXT, png_uri TEXT,
  tags TEXT, text TEXT, stats TEXT
);
CREATE INDEX cards_name_key ON cards(name_key);
CREATE INDEX cards_name_stem ON cards(name_stem);

CREATE TABLE rulings (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL,
  rule_numbers TEXT NOT NULL DEFAULT '[]', topic TEXT, topic_key TEXT,
  source_name TEXT, source_url TEXT, is_official INTEGER NOT NULL DEFAULT 0,
  effective_date TEXT, is_deprecated INTEGER NOT NULL DEFAULT 0, deprecation_note TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX rulings_kind ON rulings(kind, position);
CREATE INDEX rulings_topic ON rulings(topic_key);

-- A ruling can be about more than one piece, which is why this is a join table
-- and errata is not: an erratum changes one card's text, and a ruling routinely
-- explains what happens when two of them meet.
CREATE TABLE ruling_cards (
  ruling_id TEXT NOT NULL, card_id TEXT, card_name TEXT, card_key TEXT, card_png_uri TEXT
);
CREATE INDEX ruling_cards_key ON ruling_cards(card_key);
CREATE INDEX ruling_cards_ruling ON ruling_cards(ruling_id);

CREATE VIRTUAL TABLE rules_fts USING fts5(
  rule_number, title, content, example, rule_id UNINDEXED, tokenize = 'porter unicode61'
);
CREATE VIRTUAL TABLE terms_fts USING fts5(
  term, aliases, definition, term_id UNINDEXED, tokenize = 'porter unicode61'
);
CREATE VIRTUAL TABLE cards_fts USING fts5(
  name, type_line, card_text, card_id UNINDEXED, tokenize = 'porter unicode61'
);
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title, summary, body, note_id UNINDEXED, tokenize = 'porter unicode61'
);
CREATE VIRTUAL TABLE rulings_fts USING fts5(
  question, cards, topic, answer, ruling_id UNINDEXED, tokenize = 'porter unicode61'
);
`

/**
 * Store a field whose type varies from game to game.
 *
 * A cost is a number in one game and a string like "2R" in another, and a colour
 * is a list in one and a single word in another. The value is always encoded as
 * JSON, never written raw, because a SQLite text column has text affinity: the
 * number 2 written raw comes back as the string "2", and a store that reads it
 * back that way disagrees with a store that kept it in memory.
 */
function encodeValue(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value)
}

const json = (value: unknown) => JSON.stringify(value ?? [])

export type BuildOptions = {
  /** Where to write. Use ":memory:" for a database that never touches the disk. */
  path: string
}

/**
 * Remove a database file and the two sidecars write-ahead logging leaves.
 *
 * A build REPLACES a database; it does not add to one. Writing into a file that
 * already holds tables fails outright, and the worse outcome is the one that
 * would not fail: a corpus rebuilt after a rule was deleted would keep serving
 * the deleted rule from rows nothing overwrote.
 */
function removeExisting(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${path}${suffix}`)
    } catch (err) {
      // Absent is the ordinary case, and the only one worth ignoring.
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err
    }
  }
}

/**
 * Write `corpus` to a SQLite database and return the open handle.
 *
 * Any database already at `path` is replaced. The caller owns the handle and
 * must close it. `SqliteStore.open` is the ordinary way to read one back.
 */
export function buildDatabase(corpus: Corpus, options: BuildOptions): DatabaseSync {
  if (options.path !== ":memory:") removeExisting(options.path)
  const db = new DatabaseSync(options.path)
  db.exec(SCHEMA_SQL)
  db.exec("BEGIN")
  try {
    populate(db, corpus)
    db.exec("COMMIT")
  } catch (err) {
    db.exec("ROLLBACK")
    db.close()
    throw err
  }
  // Let the query planner see the row counts it just gained. Without this the
  // planner assumes a stock distribution and can pick a table scan over an
  // index on the very lookups this build exists to make fast.
  db.exec("ANALYZE")
  return db
}

function populate(db: DatabaseSync, corpus: Corpus): void {
  const meta = db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)")
  meta.run("game_slug", corpus.game.slug)
  meta.run("game_name", corpus.game.name)

  const book = db.prepare(
    "INSERT INTO rulebooks (id, name, slug, version, effective_date, is_active, position) VALUES (?,?,?,?,?,?,?)",
  )
  corpus.rulebooks.forEach((b, index) => {
    book.run(b.id, b.name, b.slug, b.version, b.effective_date, b.is_active ? 1 : 0, index)
  })

  const section = db.prepare(
    "INSERT INTO sections (id, rule_book_id, section_number, title, slug, description, display_order) VALUES (?,?,?,?,?,?,?)",
  )
  for (const s of corpus.sections) {
    section.run(s.id, s.rule_book_id, s.section_number, s.title, s.slug, s.description, s.display_order)
  }

  const rule = db.prepare(
    `INSERT INTO rules (id, rule_book_id, section_id, parent_id, rule_number, rule_number_key, slug,
      title, content, example, depth, display_order, rule_type, keywords, cross_references,
      is_deprecated, deprecation_note) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const ruleFts = db.prepare(
    "INSERT INTO rules_fts (rule_number, title, content, example, rule_id) VALUES (?,?,?,?,?)",
  )
  for (const r of corpus.rules) {
    rule.run(
      r.id,
      r.rule_book_id,
      r.section_id,
      r.parent_id,
      r.rule_number,
      r.rule_number.trim().toLowerCase(),
      r.slug,
      r.title,
      r.content,
      r.example,
      r.depth,
      r.display_order,
      r.rule_type,
      json(r.keywords),
      json(r.cross_references),
      r.is_deprecated ? 1 : 0,
      r.deprecation_note,
    )
    // A deprecated rule stays out of the index entirely. It is reachable by
    // number for anybody who asks for it directly, but a search must never
    // surface superseded text as the answer to a current question.
    if (!r.is_deprecated) ruleFts.run(r.rule_number, r.title ?? "", r.content, r.example ?? "", r.id)
  }

  const term = db.prepare(
    `INSERT INTO terms (id, term, term_key, slug, definition, short_definition, category, aliases,
      defining_rule_id, defining_rule_number) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  const alias = db.prepare("INSERT INTO term_aliases (term_id, alias_key) VALUES (?, ?)")
  const termFts = db.prepare("INSERT INTO terms_fts (term, aliases, definition, term_id) VALUES (?,?,?,?)")
  for (const t of corpus.terms) {
    term.run(
      t.id,
      t.term,
      normalizeName(t.term),
      t.slug,
      t.definition,
      t.short_definition,
      t.category,
      json(t.aliases),
      t.defining_rule_id,
      t.defining_rule_number,
    )
    // The term's own name is an alias of itself, so one lookup table answers
    // both "Shield" and any other spelling the corpus lists for it.
    alias.run(t.id, normalizeName(t.term))
    for (const a of t.aliases) alias.run(t.id, normalizeName(a))
    termFts.run(t.term, t.aliases.join(" "), t.definition, t.id)
  }

  const erratum = db.prepare(
    `INSERT INTO errata (id, card_id, card_name, card_key, card_png_uri, effective_date,
      original_text, errata_text, explanation, patch_note_slug, patch_note_title)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const e of corpus.errata) {
    erratum.run(
      e.id,
      e.card?.id ?? null,
      e.card?.name ?? null,
      e.card?.name ? normalizeName(e.card.name) : null,
      e.card?.png_uri ?? null,
      e.effective_date,
      e.original_text,
      e.errata_text,
      e.explanation,
      e.patch_note_slug,
      e.patch_note_title,
    )
  }

  const ban = db.prepare(
    `INSERT INTO banlist (id, card_id, card_name, card_key, card_png_uri, format_name, format_slug,
      entry_type, effective_date, reason, patch_note_slug, patch_note_title)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  for (const b of corpus.banlist) {
    ban.run(
      b.id,
      b.card?.id ?? null,
      b.card?.name ?? null,
      b.card?.name ? normalizeName(b.card.name) : null,
      b.card?.png_uri ?? null,
      b.format?.name ?? null,
      b.format?.slug ?? null,
      b.entry_type,
      b.effective_date,
      b.reason,
      b.patch_note_slug,
      b.patch_note_title,
    )
  }

  const note = db.prepare(
    `INSERT INTO patch_notes (id, slug, title, version, effective_date, category, summary, body,
      affected_rule_ids, affected_card_ids) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  )
  const noteFts = db.prepare("INSERT INTO notes_fts (title, summary, body, note_id) VALUES (?,?,?,?)")
  for (const n of corpus.patchNotes) {
    note.run(
      n.id,
      n.slug,
      n.title,
      n.version,
      n.effective_date,
      n.category,
      n.summary,
      n.body,
      json(n.affected_rule_ids),
      json(n.affected_card_ids),
    )
    noteFts.run(n.title, n.summary ?? "", n.body ?? "", n.id)
  }

  const card = db.prepare(
    `INSERT INTO cards (id, name, name_key, name_stem, type_line, rarity, set_name, png_uri,
      tags, text, stats) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const cardFts = db.prepare("INSERT INTO cards_fts (name, type_line, card_text, card_id) VALUES (?,?,?,?)")
  for (const c of corpus.cards) {
    card.run(
      c.id,
      c.name,
      normalizeName(c.name),
      nameStem(c.name),
      c.type_line,
      c.rarity,
      c.set_name,
      c.png_uri,
      encodeValue(c.tags),
      encodeValue(c.text),
      encodeValue(c.stats),
    )
    // Every text box goes into one indexed column. A reader searching for a
    // phrase does not know or care which box printed it, and indexing only the
    // main box makes an equipment card look like it has almost no text.
    cardFts.run(c.name, c.type_line ?? "", Object.values(c.text).join("\n"), c.id)
  }

  const ruling = db.prepare(
    `INSERT INTO rulings (id, kind, question, answer, rule_numbers, topic, topic_key,
      source_name, source_url, is_official, effective_date, is_deprecated, deprecation_note, position)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const rulingCard = db.prepare(
    "INSERT INTO ruling_cards (ruling_id, card_id, card_name, card_key, card_png_uri) VALUES (?,?,?,?,?)",
  )
  const rulingFts = db.prepare(
    "INSERT INTO rulings_fts (question, cards, topic, answer, ruling_id) VALUES (?,?,?,?,?)",
  )
  corpus.rulings.forEach((r, index) => {
    ruling.run(
      r.id,
      r.kind,
      r.question,
      r.answer,
      json(r.rule_numbers),
      r.topic,
      r.topic ? normalizeName(r.topic) : null,
      r.source_name,
      r.source_url,
      r.is_official ? 1 : 0,
      r.effective_date,
      r.is_deprecated ? 1 : 0,
      r.deprecation_note,
      index,
    )
    for (const c of r.cards) {
      rulingCard.run(r.id, c.id, c.name, c.name ? normalizeName(c.name) : null, c.png_uri)
    }
    // Superseded rulings stay out of the index, for the same reason deprecated
    // rules do: a search must not answer a current question with old guidance.
    // Reaching one by id still works for anybody who asks for it by name.
    if (!r.is_deprecated) {
      // Every named piece goes into one column, so a search for a card name
      // finds the ruling about it without a join.
      const cardNames = r.cards
        .map((c) => c.name)
        .filter(Boolean)
        .join(" ")
      rulingFts.run(r.question, cardNames, r.topic ?? "", r.answer, r.id)
    }
  })
}

export { CARD_WEIGHTS, RULE_WEIGHTS, RULING_WEIGHTS, TERM_WEIGHTS }
