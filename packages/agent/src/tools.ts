import type { RuleStore } from "@rulekit/corpus/store"
import type { Card, Rule } from "@rulekit/corpus/types"
import { z } from "zod"
import type { Profile } from "./profile.ts"

/**
 * One tool, in the shape every runtime here accepts.
 *
 * This is deliberately the intersection of what the AI SDK and Eve both take: a
 * name, a description the model reads to choose it, a Zod schema for the input,
 * and an async function. Neither framework appears in this file, so a third
 * runtime needs no change here.
 */
export type RuleTool = {
  name: string
  description: string
  inputSchema: z.ZodTypeAny
  execute: (input: never) => Promise<unknown>
}

/**
 * Caps on what one tool call may return.
 *
 * Every result goes into the model's context and is paid for on every later step
 * of the same turn. An unbounded result is the one failure mode that turns a
 * cheap question expensive without changing the answer.
 */
const MAX_RESULTS = 20
const MAX_CARDS = 20
const MAX_RULE_CHARS = 2000

/**
 * One flat card for the model, from the two maps the corpus stores.
 *
 * The corpus keeps a card's text boxes and its printed attributes in named maps
 * so that no game has to carry another game's columns. A model reads a flat
 * object more reliably than a nested one, so the nesting stops here: every box
 * and every attribute becomes a top-level key with the name the game gave it.
 *
 * Anything the card does not carry is absent rather than null. An empty field
 * costs tokens on every call and invites the model to narrate the absence — one
 * answer explained that "there is no effect_text recorded", naming an internal
 * field to a reader who has never heard of it.
 */
function flatCard(card: Card): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: card.id,
    name: card.name,
    type_line: card.type_line,
    rarity: card.rarity,
    set_name: card.set_name,
    png_uri: card.png_uri,
    ...card.text,
    ...card.stats,
  }
  if (card.tags.length) out.tags = card.tags
  for (const [key, value] of Object.entries(out)) {
    if (value === null || value === undefined || value === "") delete out[key]
  }
  return out
}

/** Trim a rule to what an answer can quote, dropping fields nothing reads. */
function shapeRule(rule: Rule) {
  return {
    rule_number: rule.rule_number,
    title: rule.title,
    content: rule.content.slice(0, MAX_RULE_CHARS),
    example: rule.example ? rule.example.slice(0, MAX_RULE_CHARS) : null,
    /** Kept so the hierarchy tool can be called without another search. */
    id: rule.id,
    is_deprecated: rule.is_deprecated,
    ...(rule.is_deprecated ? { deprecation_note: rule.deprecation_note } : {}),
  }
}

const limitField = (fallback: number) =>
  z.number().int().min(1).max(MAX_RESULTS).optional().describe(`How many to return. Default ${fallback}.`)

/**
 * Every tool the assistant can call, reading one store.
 *
 * There is no HTTP here, no schema discovery, and no allow-list to police. A
 * tool that does not exist cannot be called, which is a stronger guarantee than
 * a list of operations somebody has to keep correct.
 */
export function defineRulesTools(store: RuleStore, profile: Profile): RuleTool[] {
  const game = profile.game.name

  const tools: RuleTool[] = [
    {
      name: "search_all",
      description:
        `Search every ${game} collection at once: rules, defined terms, card changes, the banned and ` +
        "restricted list, and update notes. This is the right FIRST call for almost any question — a " +
        "topic, a card name, or a rule in plain words. Use a more specific tool only when this misses.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The reader's question, or the key words from it"),
        limit: limitField(8),
      }),
      async execute(input: { query: string; limit?: number }) {
        const found = await store.searchAll(input.query, { limit: input.limit ?? 8 })
        return {
          rules: found.rules.map(shapeRule),
          terms: found.terms.map((t) => ({
            term: t.term,
            definition: t.definition,
            category: t.category,
            defining_rule_number: t.defining_rule_number,
          })),
          errata: found.errata,
          banlist: found.banlist,
          patch_notes: found.patchNotes.map((n) => ({
            slug: n.slug,
            title: n.title,
            effective_date: n.effective_date,
            summary: n.summary,
          })),
        }
      },
    },

    {
      name: "search_rules",
      description:
        "Search the rule text only. Use it when a question is about the rules and a wider search " +
        "returned card rows that got in the way. Superseded rules are left out.",
      inputSchema: z.object({
        query: z.string().min(1).describe("Words to search the rule text for"),
        limit: limitField(8),
      }),
      async execute(input: { query: string; limit?: number }) {
        const hits = await store.searchRules(input.query, { limit: input.limit ?? 8 })
        return { rules: hits.map(shapeRule) }
      },
    },

    {
      name: "get_rule",
      description:
        'Read one rule by its printed number (for example "300.2.a") or by its slug. Use this ' +
        "whenever a reader names a rule number, instead of searching for it.",
      inputSchema: z
        .object({
          rule_number: z.string().optional().describe("The printed rule number"),
          slug: z.string().optional().describe("The rule's slug, from a link"),
        })
        .refine((v) => Boolean(v.rule_number || v.slug), { message: "Give a rule_number or a slug" }),
      async execute(input: { rule_number?: string; slug?: string }) {
        const rule = input.rule_number
          ? await store.getRuleByNumber(input.rule_number)
          : await store.getRuleBySlug(input.slug ?? "")
        if (!rule) return { rule: null, error: "No rule carries that number or slug." }
        return { rule: shapeRule(rule) }
      },
    },

    {
      name: "get_rule_context",
      description:
        "Read everything around one rule in a single call: its parent, its sub-rules, its siblings, " +
        "and the rules it points at. Use this instead of walking the rule tree one step at a time. " +
        "A rule whose own text is a bare heading keeps its meaning in its sub-rules, which this returns.",
      inputSchema: z.object({
        rule_id: z.string().min(1).describe("The rule id returned by a search or by get_rule"),
      }),
      async execute(input: { rule_id: string }) {
        const [self, parent, children, siblings, related] = await Promise.all([
          store.getRule(input.rule_id),
          store.getParent(input.rule_id),
          store.getChildren(input.rule_id),
          store.getSiblings(input.rule_id),
          store.getRelated(input.rule_id),
        ])
        if (!self) return { error: "No rule carries that id." }
        return {
          rule: shapeRule(self),
          parent: parent ? shapeRule(parent) : null,
          children: children.slice(0, MAX_RESULTS).map(shapeRule),
          // Siblings are the noisiest of the four and the least often needed,
          // so they are the shortest list rather than the longest.
          siblings: siblings
            .slice(0, 10)
            .map((r) => ({ rule_number: r.rule_number, title: r.title, id: r.id })),
          related: related.map(shapeRule),
        }
      },
    },

    {
      name: "search_terms",
      description:
        `Look up a defined term or keyword in the ${game} glossary. This is the RIGHT tool for ` +
        '"what is X" and "what does X mean". Use it before searching the rules: one lookup here ' +
        "answers a definition question that a rule search takes several calls to reach.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The term, keyword, or ability name"),
        limit: limitField(5),
      }),
      async execute(input: { query: string; limit?: number }) {
        const terms = await store.searchTerms(input.query, { limit: input.limit ?? 5 })
        return {
          terms: terms.map((t) => ({
            term: t.term,
            definition: t.definition,
            short_definition: t.short_definition,
            category: t.category,
            aliases: t.aliases,
            defining_rule_number: t.defining_rule_number,
            defining_rule_id: t.defining_rule_id,
          })),
        }
      },
    },

    {
      name: "list_errata",
      description:
        "Read the published changes to a card's printed text. Use it whenever a reader asks whether a " +
        "card was changed, reworded, or corrected. Report the corrected text, the original text, and " +
        "the effective date. Call it with no card name to read every change.",
      inputSchema: z.object({
        card_name: z.string().optional().describe("The card's printed name. Omit to read them all."),
        limit: limitField(20),
      }),
      async execute(input: { card_name?: string; limit?: number }) {
        const rows = await store.listErrata({ cardName: input.card_name, limit: input.limit ?? 20 })
        return { errata: rows, count: rows.length }
      },
    },

    {
      name: "list_banlist",
      description:
        "Read which cards are banned or restricted, and in which format. Use it for any question about " +
        "whether a card may be played. Report the entry type and the effective date. An empty result " +
        "means the list holds no entry for that card — say that, and say which list you read.",
      inputSchema: z.object({
        card_name: z.string().optional().describe("The card's printed name. Omit to read the whole list."),
        format: z.string().optional().describe("Limit to one format, by name or slug"),
        limit: limitField(20),
      }),
      async execute(input: { card_name?: string; format?: string; limit?: number }) {
        const rows = await store.listBanlist({
          cardName: input.card_name,
          format: input.format,
          limit: input.limit ?? 20,
        })
        return { entries: rows, count: rows.length }
      },
    },

    {
      name: "list_patch_notes",
      description:
        "Read the update notes: what changed in the rules or on the cards, and when. Use it for a " +
        "question about recent changes, or to name the source of a change you are reporting.",
      inputSchema: z.object({
        slug: z.string().optional().describe("Read one note in full by its slug"),
        limit: limitField(10),
      }),
      async execute(input: { slug?: string; limit?: number }) {
        if (input.slug) {
          const note = await store.getPatchNote(input.slug)
          return note ? { note } : { note: null, error: "No update note carries that slug." }
        }
        const notes = await store.listPatchNotes({ limit: input.limit ?? 10 })
        // The body of every note at once is a large payload nothing reads. The
        // summary is enough to choose one, and `slug` fetches that one in full.
        return { notes: notes.map(({ body: _body, ...rest }) => rest) }
      },
    },

    {
      name: "list_rulebooks",
      description:
        "List the rulebooks in this corpus, with their versions and effective dates. Use it when a " +
        "reader asks which rules you have, or when a rule number appears in more than one book.",
      inputSchema: z.object({}),
      async execute() {
        return { rulebooks: await store.listRuleBooks() }
      },
    },

    {
      name: "list_sections",
      description:
        "List the sections of a rulebook, which is its table of contents. Use it to find where a topic " +
        "lives when a search has not found it.",
      inputSchema: z.object({
        rulebook_id: z.string().optional().describe("Limit to one rulebook"),
      }),
      async execute(input: { rulebook_id?: string }) {
        const sections = await store.listSections({ ruleBookId: input.rulebook_id })
        return {
          sections: sections.map((s) => ({ section_number: s.section_number, title: s.title, id: s.id })),
        }
      },
    },
  ]

  // Card tools exist only when the corpus holds cards. A tool that can only
  // answer "nothing found" wastes a step and teaches the model to distrust the
  // result, so it is better not to offer it.
  if (profile.cards.enabled) {
    const textFields = profile.cards.textFields.map((f) => f.field)
    const readAll = textFields.length
      ? ` Read every text field it returns (${textFields.join(", ")}) — the first one alone is not the whole card.`
      : ""

    tools.push(
      {
        name: "search_cards",
        description:
          `Find ${game} cards by name, and get each one's id. This returns identity only, not the ` +
          "card's text: pass the ids to get_cards to read what a card does. It also matches a " +
          "description, so a reader who describes a card instead of naming it still reaches it.",
        inputSchema: z.object({
          query: z.string().min(1).describe("A card name, part of one, or a description"),
          limit: limitField(8),
        }),
        async execute(input: { query: string; limit?: number }) {
          const matches = await store.searchCards(input.query, { limit: input.limit ?? 8 })
          return { matches, count: matches.length }
        },
      },
      {
        name: "get_cards",
        description:
          `Read the full printed detail of one or more ${game} cards, by id, from search_cards. ` +
          "Pass EVERY id in one call when a question involves several cards, such as an interaction." +
          readAll +
          " Ground every claim about a card in this text. Never rely on memory for card text.",
        inputSchema: z.object({
          ids: z.array(z.string().min(1)).min(1).max(MAX_CARDS).describe("Card ids returned by search_cards"),
        }),
        async execute(input: { ids: string[] }) {
          const found = await store.getCards(input.ids)
          const cards = found.map(flatCard)
          const missing = input.ids.filter((id) => !found.some((c) => c.id === id))
          // Name the ids that matched nothing rather than returning a short
          // list silently. A model that cannot tell "no such card" from "I
          // forgot to ask" will assert the card does not exist.
          return { cards, ...(missing.length ? { missing } : {}) }
        },
      },
    )
  }

  return tools
}

/** Look one tool up by name. */
export function findTool(tools: RuleTool[], name: string): RuleTool | undefined {
  return tools.find((tool) => tool.name === name)
}
