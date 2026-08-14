import { nameStem, normalizeName } from "../../corpus/text.ts"
import type { BanlistEntry, Erratum, Rule, Ruling } from "../../corpus/types.ts"
import { CLAUSE_BREAK, type Classification, cardKeyCandidates, ERRATA_CUE } from "./static-classify.ts"

/** One printed card the gazetteer proves exists. */
export type CardMatch = { key: string; card: string; pngUri: string | null }

/**
 * Everything a static legality answer reads.
 *
 * `banlistOk` and `errataOk` are separate from the rows for one reason: a list
 * that loaded and holds nothing proves nothing about any card. Asserting "not
 * banned" from an empty list would call a banned card legal, so the flags gate
 * the claim rather than the rows gating it.
 */
export type StaticData = {
  /** Every printed name. The proof a card exists. */
  cards: Map<string, CardMatch>
  banlist: Map<string, BanlistEntry[]>
  errata: Map<string, Erratum[]>
  /** Rulings by the folded name of every piece each one names. */
  rulings: Map<string, Ruling[]>
  banlistOk: boolean
  errataOk: boolean
  rulingsOk: boolean
  /** The newest date on the banned list, which every verdict is stamped with. */
  asOf: string | null
  errataAsOf: string | null
}

export type RenderConfig = {
  /** The URL scheme a card link uses, without the colon. Empty means plain text. */
  linkScheme: string
}

/** How many printings one answer names before it summarises the rest. */
const PRINTING_LIMIT = 10

/** A path that would break out of a Markdown link. */
const UNSAFE_PATH = /[\s()[\]\\<>]/

function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

const titleCase = (s: string) => String(s ?? "").replace(/\b\w/g, (c) => c.toUpperCase())

/**
 * A card name as a link, or bold when there is no usable image path.
 *
 * The image path comes from imported data, so it is not trusted: a value holding
 * a bracket or a parenthesis would close the link early and let the rest of the
 * answer render as markup.
 */
export function cardLink(name: string, pngUri: string | null | undefined, config: RenderConfig): string {
  const label = String(name ?? "").trim()
  if (!label) return ""
  const path = typeof pngUri === "string" ? pngUri.trim() : ""
  if (!config.linkScheme || !path || UNSAFE_PATH.test(path) || hasControlChar(path)) return `**${label}**`
  return `[${label}](${config.linkScheme}:${path})`
}

/**
 * True when a printed card is FILED under `key`.
 *
 * This is the line between "a printing of the card the reader named" and "a
 * different card whose name happens to start with the same words". A character
 * name reaches every printing that carries it; a single word that merely opens a
 * longer name reaches nothing.
 */
function filedUnder(match: CardMatch, key: string): boolean {
  return match.key === key || nameStem(match.card) === key
}

/**
 * Every printed card a key names, in gazetteer order.
 *
 * The leading-run scan is wide on purpose, and `filedUnder` then keeps only the
 * printings the key really owns. Without that second half, a one-word key lists
 * every card starting with that word as though they were printings of it, and a
 * single banned row on the longer name turns that list into a ban verdict about
 * a card the reader never named.
 */
export function resolveCards(cardKey: string, data: StaticData): CardMatch[] {
  if (!cardKey) return []
  // A one- or two-letter fragment is not a name. "is it legal to attack twice"
  // classifies with the entity "it", and a prefix match on two letters would
  // pull in every card whose name starts that way.
  const prefixOk = cardKey.length >= 3
  const reaches = (key: string) => key === cardKey || (prefixOk && key.startsWith(`${cardKey} `))

  const found = new Map<string, CardMatch>()
  const add = (match: CardMatch) => {
    const seen = found.get(match.card)
    if (seen) {
      if (!seen.pngUri && match.pngUri) seen.pngUri = match.pngUri
      return
    }
    found.set(match.card, { ...match })
  }

  for (const [key, row] of data.cards) if (reaches(key)) add(row)
  // The banned list and the card changes name cards too. They are what a partial
  // load leaves behind when the gazetteer itself failed.
  for (const index of [data.banlist, data.errata]) {
    for (const [key, rows] of index) {
      const first = rows[0]
      const name = first?.card?.name
      if (reaches(key) && name) add({ key, card: name, pngUri: first?.card?.png_uri ?? null })
    }
  }
  // Rulings name pieces too, and one ruling can name several, so the matching
  // one is found by key rather than taken from the front of the list.
  for (const [key, rows] of data.rulings) {
    if (!reaches(key)) continue
    const card = rows.flatMap((r) => r.cards).find((c) => c.name && normalizeName(c.name) === key)
    if (card?.name) add({ key, card: card.name, pngUri: card.png_uri })
  }
  return [...found.values()].filter((match) => filedUnder(match, cardKey))
}

/**
 * Resolve the card a question named, narrowing the key only when the literal key
 * finds nothing.
 *
 * Without the narrowing, one adverb sends a banned card to a model: "Is X still
 * banned?" captures the key "x still", which no index holds, so the answer was
 * null and something else answered a ban question from nothing.
 *
 * A question naming TWO cards resolves both. Answering about the first alone is
 * worse than declining, because a verdict that silently covers one reads as a
 * verdict that covers both.
 */
export function resolveNamedCard(
  cardKey: string,
  data: StaticData,
): { key: string; matches: CardMatch[]; names: string[] } {
  const candidates = cardKeyCandidates(cardKey)
  const nothing = { key: String(cardKey ?? ""), matches: [] as CardMatch[], names: [] as string[] }
  if (!candidates.length) return nothing

  const literal = resolveCards(candidates[0] as string, data)
  if (literal.length)
    return { key: candidates[0] as string, matches: literal, names: [candidates[0] as string] }

  // Each clause on its own, BEFORE the narrowed candidates. Otherwise the
  // narrowing stops at the first name and answers half of a two-card question.
  const parts = String(cardKey ?? "")
    .split(CLAUSE_BREAK)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length > 1) {
    const named: { key: string; matches: CardMatch[] }[] = []
    for (const part of parts) {
      const matches = resolveCards(part, data)
      if (matches.length) {
        named.push({ key: part, matches })
        continue
      }
      // The clause is the SECOND QUESTION, not a second name. Dropping it is
      // what lets the card half answer.
      if (ERRATA_CUE.test(part)) continue
      // Neither a name we can prove nor a question we recognise. It may be a
      // card this answer would then be silently wrong about, so decline it all.
      return nothing
    }
    if (!named.length) return nothing
    const byCard = new Map<string, CardMatch>()
    for (const part of named) for (const match of part.matches) byCard.set(match.card, match)
    const names = named.map((part) => part.key)
    return { key: names.join(" and "), matches: [...byCard.values()], names }
  }

  for (const key of candidates.slice(1)) {
    const matches = resolveCards(key, data)
    if (matches.length) return { key, matches, names: [key] }
  }
  return nothing
}

const newestDate = (dates: (string | null)[]) => {
  const sorted = dates.filter(Boolean).sort() as string[]
  return sorted.length ? (sorted[sorted.length - 1] as string) : null
}

/**
 * The date stamp every legality answer ends with.
 *
 * A verdict with no date cannot be audited. An answer may be cached for weeks
 * while the list changes underneath it, and the date is what lets a reader see
 * which version of the list the verdict was read from.
 */
const effectiveStamp = (date: string | null) => (date ? ` Effective ${date}.` : "")

const ownedBy = (match: CardMatch, name: string) => match.key === name || match.key.startsWith(`${name} `)

/** A bullet list of printings, with the overflow summarised. */
function printingList(heading: string, matches: CardMatch[], config: RenderConfig): string {
  if (!matches.length) return ""
  const shown = matches.slice(0, PRINTING_LIMIT)
  const lines = shown.map((m) => `- ${cardLink(m.card, m.pngUri, config)}`)
  const extra = matches.length - shown.length
  if (extra > 0) lines.push(`- and ${extra} more printing${extra === 1 ? "" : "s"} of the same name`)
  return `\n\n${heading}\n${lines.join("\n")}`
}

/**
 * Split matches into one list per resolved name.
 *
 * Every heading then states what its own bullets are. One heading over the
 * printings of two cards is a false sentence whichever verdict it sits under.
 */
function ownedBlocks(
  names: string[],
  matches: CardMatch[],
  headingFor: (name: string) => string,
  restHeading: string,
  config: RenderConfig,
): string {
  if (!matches.length) return ""
  const owned = new Map<string, CardMatch[]>(names.map((name) => [name, []]))
  const rest: CardMatch[] = []
  for (const match of matches) {
    const owner = names.find((name) => ownedBy(match, name))
    if (owner) owned.get(owner)?.push(match)
    else rest.push(match)
  }
  const blocks = [...owned].map(([name, rows]) => printingList(headingFor(titleCase(name)), rows, config))
  blocks.push(printingList(restHeading, rest, config))
  return blocks.join("")
}

function renderBanRows(entries: BanlistEntry[]): string {
  return entries
    .map((e) => {
      const when = e.effective_date ? `, effective ${e.effective_date}` : ""
      const source = e.patch_note_title ? ` — source: ${e.patch_note_title}` : ""
      return `- **${e.entry_type}** in **${e.format?.name ?? "an unlisted format"}**${when}${source}`
    })
    .join("\n")
}

/**
 * The subject of a verdict sentence, and whether it is plural.
 *
 * A two-card verdict must not read "**A And B** is not banned": one bold string,
 * a singular verb, and a card name the renderer invented. Each name is written
 * on its own, so the sentence says what it covers.
 */
function verdictHead(
  label: string,
  matches: CardMatch[],
  names: string[],
  config: RenderConfig,
): { head: string; plural: boolean } {
  if (matches.length === 1) {
    const only = matches[0] as CardMatch
    return { head: cardLink(only.card, only.pngUri, config), plural: false }
  }
  if (names.length > 1) {
    const parts = names.map((name) => {
      const owned = matches.filter((match) => ownedBy(match, name))
      const first = owned[0]
      return owned.length === 1 && first
        ? cardLink(first.card, first.pngUri, config)
        : `**${titleCase(name)}**`
    })
    return { head: parts.join(" and "), plural: true }
  }
  return { head: `**${label}**`, plural: false }
}

/** The printings a verdict checked, split by name when it covers more than one. */
function checkedBlocks(matches: CardMatch[], names: string[], config: RenderConfig): string {
  if (matches.length === 1) return ""
  if (names.length > 1) {
    // A name covering exactly one printing is already written as that printing
    // in the head. Repeating it under a heading built from the folded key adds
    // nothing and loses the punctuation.
    const listed = names.filter((name) => matches.filter((match) => ownedBy(match, name)).length > 1)
    const rows = matches.filter(
      (match) => !names.some((name) => ownedBy(match, name)) || listed.some((name) => ownedBy(match, name)),
    )
    return ownedBlocks(
      listed,
      rows,
      (name) => `The printings of ${name} it checked:`,
      "The printings it checked:",
      config,
    )
  }
  return printingList("The printings it checked:", matches, config)
}

export function renderRule(rule: Rule, sectionTitle?: string | null): string {
  const head = rule.title ? `**Rule ${rule.rule_number} — ${rule.title}**` : `**Rule ${rule.rule_number}**`
  const body = rule.content.trim()
  if (!body) return `${head}${sectionTitle ? ` (in "${sectionTitle}")` : ""}.`
  const quoted = body.replace(/\n/g, "\n> ")
  const example = rule.example ? `\n\nExample: ${rule.example.trim()}` : ""
  const superseded = rule.is_deprecated
    ? `\n\nThis rule is superseded.${rule.deprecation_note ? ` ${rule.deprecation_note}` : ""}`
    : ""
  return `${head}:\n\n> ${quoted}${example}${superseded}`
}

/** Group banned-list rows by their printed card name, in order. */
function groupByCard(entries: BanlistEntry[]): Map<string, BanlistEntry[]> {
  const groups = new Map<string, BanlistEntry[]>()
  for (const e of entries) {
    const name = e.card?.name ?? "an unnamed card"
    const found = groups.get(name)
    if (found) found.push(e)
    else groups.set(name, [e])
  }
  return groups
}

/**
 * A ban verdict, plus the printings of the same name that carry no row.
 *
 * A reader who asks about a character means every printing of it, and often only
 * one is banned. An answer naming the banned printing alone reads as "this
 * character is banned", and the reader then leaves the legal ones out of a deck.
 * Naming the rest is the difference between a true answer and a true sentence.
 */
export function renderBan(
  entries: BanlistEntry[],
  unlisted: CardMatch[],
  names: string[],
  config: RenderConfig,
): string {
  const blocks = [...groupByCard(entries).values()].map((rows) => {
    const first = rows[0] as BanlistEntry
    return `${cardLink(first.card?.name ?? "", first.card?.png_uri, config)} is on the banned list:\n${renderBanRows(rows)}`
  })
  const rest = ownedBlocks(
    names,
    unlisted,
    (name) => `These printings of ${name} are not on the banned list:`,
    "These printings are not on the banned list:",
    config,
  )
  const asOf = newestDate(entries.map((e) => e.effective_date)) ?? "an unlisted date"
  return `${blocks.join("\n\n")}${rest}\n\nEffective ${asOf}.`
}

export function renderWholeBanlist(
  banlist: Map<string, BanlistEntry[]>,
  asOf: string,
  config: RenderConfig,
): string {
  const keys = [...banlist.keys()].sort()
  const blocks = keys.map((key) => {
    const rows = banlist.get(key) as BanlistEntry[]
    const first = rows[0] as BanlistEntry
    return `${cardLink(first.card?.name ?? "", first.card?.png_uri, config)}\n${renderBanRows(rows)}`
  })
  const count = keys.length
  return `${count} card${count === 1 ? " is" : "s are"} on the banned list:\n\n${blocks.join("\n\n")}\n\nEffective ${asOf}.`
}

export function renderNotBanned(
  label: string,
  asOf: string | null,
  matches: CardMatch[],
  names: string[],
  config: RenderConfig,
): string {
  const { head, plural } = verdictHead(label, matches, names, config)
  return (
    `${head} ${plural ? "are" : "is"} not on the banned list in any tracked format.` +
    `${effectiveStamp(asOf)}${checkedBlocks(matches, names, config)}`
  )
}

export function renderErrata(entries: Erratum[], config: RenderConfig): string {
  return entries
    .map((e) => {
      const when = e.effective_date ? ` (effective ${e.effective_date})` : ""
      const original = e.original_text
        ? `\n\n**Original text:**\n> ${e.original_text.replace(/\n/g, "\n> ")}`
        : ""
      const corrected = e.errata_text
        ? `\n\n**Corrected text:**\n> ${e.errata_text.replace(/\n/g, "\n> ")}`
        : ""
      const why = e.explanation ? `\n\n${e.explanation}` : ""
      const source = e.patch_note_title ? `\n\nSource: ${e.patch_note_title}.` : ""
      return `${cardLink(e.card?.name ?? "", e.card?.png_uri, config)} was changed${when}.${original}${corrected}${why}${source}`
    })
    .join("\n\n---\n\n")
}

export function renderNoErrata(
  label: string,
  asOf: string | null,
  matches: CardMatch[],
  names: string[],
  config: RenderConfig,
): string {
  const { head, plural } = verdictHead(label, matches, names, config)
  return (
    `${head} ${plural ? "have" : "has"} no recorded change to its printed text.` +
    `${effectiveStamp(asOf)}${checkedBlocks(matches, names, config)}`
  )
}

/**
 * The published rulings on one card.
 *
 * Every ruling states who published it and whether it is official, because a
 * reader weighs those two facts before the answer itself. `is_official` is false
 * unless the corpus says otherwise, so an unlabelled ruling reads as unofficial
 * rather than as the publisher's word.
 *
 * The rule numbers come out as a plain list, not as quoted rule text. This stage
 * reads no rules, and printing a number a reader can look up is honest where
 * paraphrasing the rule behind it would not be.
 */
export function renderRulings(rulings: Ruling[], config: RenderConfig): string {
  return rulings
    .map((r) => {
      const cards = r.cards
        .map((c) => cardLink(c.name ?? "", c.png_uri, config))
        .filter(Boolean)
        .join(", ")
      const about = cards ? `${cards} — ` : ""
      const withdrawn = r.is_deprecated
        ? `\n\n**This ruling was withdrawn.**${r.deprecation_note ? ` ${r.deprecation_note}` : ""}`
        : ""
      const rules = r.rule_numbers.length ? `\n\nRests on: ${r.rule_numbers.join(", ")}.` : ""
      // The source is a LINK when the row carries one. A licence such as
      // CC BY-SA asks for a credit and a link, and the corpus holds both, so
      // printing only the name leaves an obligation impossible to meet without
      // putting markup inside `source_name`.
      const named = r.source_name
        ? r.source_url && !UNSAFE_PATH.test(r.source_url) && !hasControlChar(r.source_url)
          ? `[${r.source_name}](${r.source_url})`
          : r.source_name
        : ""
      const label = r.is_official ? "Official ruling" : "Unofficial ruling"
      const when = r.effective_date ? `, ${r.effective_date}` : ""
      const who = named ? `\n\n${label}, from ${named}${when}.` : `\n\n${label}${when}.`
      return `${about}**${r.question}**\n\n${r.answer}${withdrawn}${rules}${who}`
    })
    .join("\n\n---\n\n")
}

export function renderNoRulings(
  label: string,
  matches: CardMatch[],
  names: string[],
  config: RenderConfig,
): string {
  const { head, plural } = verdictHead(label, matches, names, config)
  return (
    `${head} ${plural ? "have" : "has"} no published ruling in the rulings data.` +
    `${checkedBlocks(matches, names, config)}`
  )
}

/** The prose name a multi-name answer is headed with. */
const joinNames = (names: string[]) => names.map(titleCase).join(" and ")

/** The rows of an index belonging to any resolved card, in resolution order. */
const entriesFor = <T>(matches: CardMatch[], index: Map<string, T[]>): T[] =>
  matches.flatMap((m) => index.get(m.key) ?? [])

export type StaticAnswer = { text: string; citations: Record<string, unknown>[]; source: string }

/**
 * Render the card half of a static answer, or null to fall through.
 *
 * Pure. Every "no row exists" claim below is gated on three things: the list
 * loaded, it carries a date to stamp the claim with, and the gazetteer proves
 * the card is real. Reading existence off the same index the question is about
 * would be circular.
 */
export function renderCardAnswer(
  c: Classification,
  data: StaticData,
  config: RenderConfig,
): StaticAnswer | null {
  if (c.intent === "BANLIST") {
    if (!data.banlistOk || !data.asOf) return null
    const firsts = [...data.banlist.values()].map((rows) => rows[0] as BanlistEntry)
    return {
      source: "banlist",
      citations: firsts.map((e) => ({ card: e.card?.name, effectiveDate: e.effective_date })),
      text: renderWholeBanlist(data.banlist, data.asOf, config),
    }
  }

  const { key: resolvedKey, matches, names } = resolveNamedCard(c.cardKey ?? "", data)
  // A one-name answer keeps the reader's own capitalisation, but only while the
  // literal key is what matched: after narrowing it still holds the whole
  // clause, so the narrowed key is the truthful label.
  const namedAs = resolvedKey === c.cardKey ? titleCase(c.cardRaw ?? "") : joinNames(names)
  const cardSubject = { matches, names, label: namedAs }

  const errataHalf = (subject: { matches: CardMatch[]; names: string[]; label: string }) => {
    const entries = entriesFor(subject.matches, data.errata)
    if (entries.length) {
      return {
        citations: entries.map((e) => ({ card: e.card?.name, effectiveDate: e.effective_date })),
        text: renderErrata(entries, config),
      }
    }
    const known = subject.matches.filter((m) => data.cards.has(m.key))
    if (data.errataOk && data.errataAsOf && known.length) {
      return {
        citations: [] as Record<string, unknown>[],
        text: renderNoErrata(subject.label, data.errataAsOf, known, subject.names, config),
      }
    }
    return null
  }

  if (c.intent === "BANNED") {
    // "Can I play X, and has its text changed?" asks two questions, and the rows
    // answer both. The text half can name a card of its own; when it names one
    // nothing proves, the whole question declines rather than answering the text
    // question about the legality subject instead.
    let textSubject = cardSubject
    if (c.alsoErrata && c.errataClause) {
      const own = resolveNamedCard(c.errataClause, data)
      if (!own.matches.length) return null
      textSubject = { matches: own.matches, names: own.names, label: joinNames(own.names) }
    }
    const alsoErrata = c.alsoErrata ? errataHalf(textSubject) : null
    const append = (answer: StaticAnswer): StaticAnswer =>
      alsoErrata
        ? {
            ...answer,
            citations: [...answer.citations, ...alsoErrata.citations],
            text: `${answer.text}\n\n---\n\n${alsoErrata.text}`,
          }
        : answer

    const entries = entriesFor(matches, data.banlist)
    if (entries.length) {
      const unlisted = matches.filter((m) => !data.banlist.get(m.key)?.length)
      return append({
        source: "banlist",
        citations: entries.map((e) => ({
          card: e.card?.name,
          format: e.format?.name,
          effectiveDate: e.effective_date,
        })),
        text: renderBan(entries, unlisted, names, config),
      })
    }
    // Only assert "not on the list" when the list itself loaded, it carries a
    // date, AND the card is one the gazetteer proves is real. An unknown name
    // may be misspelled, from another game, or nonexistent, and calling it legal
    // is a confident answer about nothing.
    if (data.banlistOk && data.asOf && matches.length) {
      return append({
        source: "banlist",
        citations: [],
        text: renderNotBanned(namedAs, data.asOf, matches, names, config),
      })
    }
    return null
  }

  if (c.intent === "ERRATA") {
    const half = errataHalf(cardSubject)
    return half ? { source: "errata", ...half } : null
  }

  if (c.intent === "RULINGS") {
    const entries = entriesFor(matches, data.rulings)
    if (entries.length) {
      return {
        source: "rulings",
        citations: entries.map((r) => ({
          ruling: r.id,
          card: r.cards.map((card) => card.name).filter(Boolean),
          ruleNumbers: r.rule_numbers,
          sourceName: r.source_name,
          sourceUrl: r.source_url,
          official: r.is_official,
        })),
        text: renderRulings(entries, config),
      }
    }
    // Same gate as the ban verdict, and for the same reason. "No ruling exists"
    // is a claim, and a name the gazetteer does not know may be misspelled or
    // from another game. An unproven name falls through to the agent, which can
    // read the rules and say something useful.
    const known = matches.filter((m) => data.cards.has(m.key))
    if (data.rulingsOk && known.length) {
      return {
        source: "rulings",
        citations: [],
        text: renderNoRulings(namedAs, known, names, config),
      }
    }
    return null
  }

  return null
}

/** Build the lookup indexes one static answer reads. */
export function indexStaticData(input: {
  cardNames: { id: string; name: string; png_uri: string | null }[]
  banlist: BanlistEntry[]
  errata: Erratum[]
  rulings: Ruling[]
  banlistLoaded: boolean
  errataLoaded: boolean
  rulingsLoaded: boolean
}): StaticData {
  const cards = new Map<string, CardMatch>()
  for (const row of input.cardNames) {
    const key = normalizeName(row.name)
    if (!key) continue
    const seen = cards.get(key)
    // One name can be printed several times. The first row wins, and a later one
    // only fills in an image path the first lacked.
    if (seen) {
      if (!seen.pngUri && row.png_uri) seen.pngUri = row.png_uri
      continue
    }
    cards.set(key, { key, card: row.name, pngUri: row.png_uri })
  }

  const group = <T extends { card?: { name?: string | null } | null }>(rows: T[]) => {
    const out = new Map<string, T[]>()
    for (const row of rows) {
      const name = row.card?.name
      if (!name) continue
      const key = normalizeName(name)
      const found = out.get(key)
      if (found) found.push(row)
      else out.set(key, [row])
    }
    return out
  }

  // A ruling files under EVERY piece it names, so `group` cannot build this map:
  // `group` reads one card per row. A ruling about two pieces meeting has to be
  // found from either of their names.
  const rulings = new Map<string, Ruling[]>()
  for (const ruling of input.rulings) {
    for (const card of ruling.cards) {
      const key = card.name ? normalizeName(card.name) : ""
      if (!key) continue
      const found = rulings.get(key)
      if (found) found.push(ruling)
      else rulings.set(key, [ruling])
    }
  }

  // A list that loaded and holds nothing is the same information state as one
  // that failed: it proves nothing about any card, so it may not license a
  // "no row exists" claim.
  return {
    cards,
    banlist: group(input.banlist),
    errata: group(input.errata),
    rulings,
    banlistOk: input.banlistLoaded && input.banlist.length > 0,
    errataOk: input.errataLoaded && input.errata.length > 0,
    rulingsOk: input.rulingsLoaded && input.rulings.length > 0,
    asOf: newestDate(input.banlist.map((b) => b.effective_date)),
    errataAsOf: newestDate(input.errata.map((e) => e.effective_date)),
  }
}
