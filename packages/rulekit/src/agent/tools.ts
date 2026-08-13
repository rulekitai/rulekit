import { z } from "zod"
import { RULING_KINDS } from "../corpus/schema.ts"
import type { RuleStore } from "../corpus/store.ts"
import type { Card, Rule, Ruling } from "../corpus/types.ts"
import type { TraceStep } from "./events.ts"
import { type Profile, pieceNoun } from "./profile.ts"

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
  /**
   * Extra trace detail, read from the result the call returned.
   *
   * The trace is the only structured thing a browser sees from an agent turn:
   * the answer itself arrives as prose. A tool that did something a reader must
   * know about, such as a page outside the corpus, says so here. The interface
   * can then mark it. Returning nothing leaves the step as it was.
   */
  describeResult?: (result: unknown) => Partial<TraceStep> | undefined
  /**
   * True when this tool deliberately takes the name of another one.
   *
   * Two tools of one name would otherwise throw. Set this to replace a built-in
   * on purpose: a corpus search of your own in place of `search_all`, for one.
   * The tool that sets it wins, and the one it replaced never reaches the model.
   */
  replaces?: boolean
}

/**
 * What a tool name may hold.
 *
 * This is Eve's `TOOL_SLUG_PATTERN`, from `eve/dist/src/discover/grammar.js`.
 * Eve names a tool after its file, so a name outside this pattern stops
 * `pnpm eve build` for anybody who runs the Eve template.
 *
 * THE AI SDK CHECKS NOTHING. Its `tool()` is an identity function, and a tool
 * name reaches it as an object key. So this check is the only one there is, and
 * removing it moves the failure to somebody else's build.
 */
const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

/** One tool, before `defineTool` widens it. `S` is what gives `execute` its type. */
export type ToolSpec<S extends z.ZodTypeAny> = {
  name: string
  description: string
  inputSchema: S
  /** `input` is inferred from `inputSchema`, so the compiler checks this body. */
  execute: (input: z.output<S>) => Promise<unknown>
  describeResult?: (result: unknown) => Partial<TraceStep> | undefined
  replaces?: boolean
}

/**
 * Define one tool, with `execute`'s input inferred from the schema.
 *
 * Write a tool this way rather than as a plain object. `RuleTool.execute` takes
 * `never` so that any concrete input type satisfies it, which means a plain
 * object gets NO inference: a hand-written `input:` annotation can disagree with
 * the schema beside it, and nothing reports that. The generic below is what
 * compares the two.
 *
 * It also checks the name, because a name is the one field with an outside
 * constraint. See `TOOL_NAME`.
 */
export function defineTool<S extends z.ZodTypeAny>(spec: ToolSpec<S>): RuleTool {
  if (!TOOL_NAME.test(spec.name)) {
    throw new Error(
      `"${spec.name}" is not a usable tool name. A name starts with a letter, then holds letters, ` +
        "digits, underscores, and hyphens, up to 64 characters. Eve names a tool after its file, " +
        "and rejects anything else.",
    )
  }
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    // The one cast in this file. The generic above already compared the body
    // against the schema, and `never` is what lets every concrete input type
    // satisfy the shared `RuleTool` shape.
    execute: spec.execute as RuleTool["execute"],
    ...(spec.describeResult ? { describeResult: spec.describeResult } : {}),
    ...(spec.replaces ? { replaces: true } : {}),
  }
}

/**
 * Refuse a tool list that holds one name two times.
 *
 * The runtime builds its tool map with `Object.fromEntries`, and a repeated key
 * keeps the LAST entry. So a caller who adds a tool named `get_rule` through
 * `extraTools` silently removes the built-in `get_rule`, and the agent loses its
 * most-used lookup. Nothing failed, and the only symptom was a worse answer.
 *
 * A tool that sets `replaces` means to do this, and passes.
 */
export function assertUniqueToolNames(tools: RuleTool[]): void {
  const seen = new Set<string>()
  for (const tool of tools) {
    if (seen.has(tool.name) && !tool.replaces) {
      throw new Error(
        `Two tools are named "${tool.name}", and the second one would silently replace the first. ` +
          "Rename your tool, or set `replaces: true` on it when you mean to take that name.",
      )
    }
    seen.add(tool.name)
  }
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
/**
 * What a corpus actually holds, so a tool that can answer nothing is not offered.
 *
 * A game with no banned list still had a tool for one. The model spends a step
 * calling it, reads an empty list, and learns that this project's tools return
 * nothing. Chess, poker, and the property game each carried three such tools.
 */
export type CorpusContents = {
  errata: boolean
  banlist: boolean
  patchNotes: boolean
  rulings: boolean
}

/** Read which collections hold anything. One cheap count each. */
export async function corpusContents(store: RuleStore): Promise<CorpusContents> {
  const [errata, banlist, patchNotes, rulings] = await Promise.all([
    store.listErrata({ limit: 1 }),
    store.listBanlist({ limit: 1 }),
    store.listPatchNotes({ limit: 1 }),
    // A store written before rulings existed has no such method, and that is a
    // corpus with no rulings as far as this is concerned. The same test then
    // serves twice: it withholds the tool from an empty collection and from a
    // store that could not read one.
    store.listRulings ? store.listRulings({ limit: 1 }) : Promise.resolve([]),
  ])
  return {
    errata: errata.length > 0,
    banlist: banlist.length > 0,
    patchNotes: patchNotes.length > 0,
    rulings: rulings.length > 0,
  }
}

const ALL_PRESENT: CorpusContents = { errata: true, banlist: true, patchNotes: true, rulings: true }

/** Trim a ruling to what an answer can quote and cite. */
function shapeRuling(ruling: Ruling) {
  return {
    id: ruling.id,
    kind: ruling.kind,
    question: ruling.question,
    answer: ruling.answer,
    /** The rules the ruling rests on. Read each one before you quote the ruling. */
    rule_numbers: ruling.rule_numbers,
    cards: ruling.cards.map((c) => c.name).filter(Boolean),
    topic: ruling.topic,
    source_name: ruling.source_name,
    source_url: ruling.source_url,
    is_official: ruling.is_official,
    effective_date: ruling.effective_date,
    is_deprecated: ruling.is_deprecated,
    ...(ruling.is_deprecated ? { deprecation_note: ruling.deprecation_note } : {}),
  }
}

export function defineRulesTools(
  store: RuleStore,
  profile: Profile,
  contents: CorpusContents = ALL_PRESENT,
): RuleTool[] {
  const game = profile.game.name
  const { one: piece, many: pieces } = pieceNoun(profile)

  // Name only the collections this corpus holds. A list of five where two are
  // always empty teaches the model to expect nothing from any of them.
  const searchable = [
    "rules",
    "defined terms",
    contents.errata ? `changes to a ${piece}'s text` : null,
    contents.banlist ? "the banned and restricted list" : null,
    contents.patchNotes ? "update notes" : null,
    contents.rulings ? "published rulings" : null,
  ].filter(Boolean)

  const tools: RuleTool[] = [
    defineTool({
      name: "search_all",
      description:
        `Search every ${game} collection at once: ${searchable.join(", ")}. This is the right FIRST ` +
        `call for almost any question — a topic, the name of a ${piece}, or a rule in plain words. ` +
        "Use a more specific tool only when this misses.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The reader's question, or the key words from it"),
        limit: limitField(8),
      }),
      async execute(input) {
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
          rulings: (found.rulings ?? []).map(shapeRuling),
        }
      },
    }),

    defineTool({
      name: "search_rules",
      description:
        "Search the rule text only. Use it when a question is about the rules and a wider search " +
        `returned ${piece} rows that got in the way. Superseded rules are left out.`,
      inputSchema: z.object({
        query: z.string().min(1).describe("Words to search the rule text for"),
        limit: limitField(8),
      }),
      async execute(input) {
        const hits = await store.searchRules(input.query, { limit: input.limit ?? 8 })
        return { rules: hits.map(shapeRule) }
      },
    }),

    defineTool({
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
      async execute(input) {
        const rule = input.rule_number
          ? await store.getRuleByNumber(input.rule_number)
          : await store.getRuleBySlug(input.slug ?? "")
        if (!rule) return { rule: null, error: "No rule carries that number or slug." }
        return { rule: shapeRule(rule) }
      },
    }),

    defineTool({
      name: "get_rule_context",
      description:
        "Read everything around one rule in a single call: its parent, its sub-rules, its siblings, " +
        "and the rules it points at. Use this instead of walking the rule tree one step at a time. " +
        "A rule whose own text is a bare heading keeps its meaning in its sub-rules, which this returns.",
      inputSchema: z.object({
        rule_id: z.string().min(1).describe("The rule id returned by a search or by get_rule"),
      }),
      async execute(input) {
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
    }),

    defineTool({
      name: "search_terms",
      description:
        `Look up a defined term or keyword in the ${game} glossary. This is the RIGHT tool for ` +
        '"what is X" and "what does X mean". Use it before searching the rules: one lookup here ' +
        "answers a definition question that a rule search takes several calls to reach.",
      inputSchema: z.object({
        query: z.string().min(1).describe("The term, keyword, or ability name"),
        limit: limitField(5),
      }),
      async execute(input) {
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
    }),

    defineTool({
      name: "list_rulebooks",
      description:
        "List the rulebooks in this corpus, with their versions and effective dates. Use it when a " +
        "reader asks which rules you have, or when a rule number appears in more than one book.",
      inputSchema: z.object({}),
      async execute() {
        return { rulebooks: await store.listRuleBooks() }
      },
    }),

    defineTool({
      name: "list_sections",
      description:
        "List the sections of a rulebook, which is its table of contents. Use it to find where a topic " +
        "lives when a search has not found it.",
      inputSchema: z.object({
        rulebook_id: z.string().optional().describe("Limit to one rulebook"),
      }),
      async execute(input) {
        const sections = await store.listSections({ ruleBookId: input.rulebook_id })
        return {
          sections: sections.map((s) => ({ section_number: s.section_number, title: s.title, id: s.id })),
        }
      },
    }),
  ]

  // Card tools exist only when the corpus holds cards. A tool that can only
  // answer "nothing found" wastes a step and teaches the model to distrust the
  // result, so it is better not to offer it.
  // Offered only when the corpus holds one. A tool that can answer nothing
  // costs a step and teaches the model that these tools return nothing.
  if (contents.errata)
    tools.push(
      defineTool({
        name: "list_errata",
        description:
          `Read the published changes to a ${piece}'s printed text. Use it whenever a reader asks ` +
          `whether a ${piece} was changed, reworded, or corrected. Report the corrected text, the ` +
          `original text, and the effective date. Call it with no name to read every change.`,
        inputSchema: z.object({
          card_name: z.string().optional().describe(`The ${piece}'s printed name. Omit to read them all.`),
          limit: limitField(20),
        }),
        async execute(input) {
          const rows = await store.listErrata({ cardName: input.card_name, limit: input.limit ?? 20 })
          return { errata: rows, count: rows.length }
        },
      }),
    )

  // Offered only when the corpus holds one. A tool that can answer nothing
  // costs a step and teaches the model that these tools return nothing.
  if (contents.banlist)
    tools.push(
      defineTool({
        name: "list_banlist",
        description:
          `Read which ${pieces} are banned or restricted, and in which format. Use it for any question ` +
          `about whether a ${piece} may be played. Report the entry type and the effective date. An ` +
          `empty result means the list holds no entry for that ${piece} — say that, and say which list ` +
          "you read.",
        inputSchema: z.object({
          card_name: z
            .string()
            .optional()
            .describe(`The ${piece}'s printed name. Omit to read the whole list.`),
          format: z.string().optional().describe("Limit to one format, by name or slug"),
          limit: limitField(20),
        }),
        async execute(input) {
          const rows = await store.listBanlist({
            cardName: input.card_name,
            format: input.format,
            limit: input.limit ?? 20,
          })
          return { entries: rows, count: rows.length }
        },
      }),
    )

  // Offered only when the corpus holds one. A tool that can answer nothing
  // costs a step and teaches the model that these tools return nothing.
  if (contents.patchNotes)
    tools.push(
      defineTool({
        name: "list_patch_notes",
        description:
          `Read the update notes: what changed in the rules or on the ${pieces}, and when. Use it for ` +
          "a question about recent changes, or to name the source of a change you are reporting.",
        inputSchema: z.object({
          slug: z.string().optional().describe("Read one note in full by its slug"),
          limit: limitField(10),
        }),
        async execute(input) {
          if (input.slug) {
            const note = await store.getPatchNote(input.slug)
            return note ? { note } : { note: null, error: "No update note carries that slug." }
          }
          const notes = await store.listPatchNotes({ limit: input.limit ?? 10 })
          // The body of every note at once is a large payload nothing reads. The
          // summary is enough to choose one, and `slug` fetches that one in full.
          return { notes: notes.map(({ body: _body, ...rest }) => rest) }
        },
      }),
    )

  // Offered only when the corpus holds one. A tool that can answer nothing
  // costs a step and teaches the model that these tools return nothing.
  if (contents.rulings)
    tools.push(
      defineTool({
        name: "list_rulings",
        description:
          `Read published rulings: a question somebody already asked about ${game}, the answer, and ` +
          "the rules that answer rests on. Use it when a reader asks how something works in a specific " +
          `situation, or names a ${piece} and asks what happens. A ruling is NOT a rule: it reads the ` +
          "rules and applies them to one case, so read the rule numbers it cites before you quote it. " +
          "Report whether the ruling is official, and name its source.",
        inputSchema: z.object({
          card_name: z.string().optional().describe(`Rulings that name this ${piece}`),
          kind: z
            .enum(RULING_KINDS)
            .optional()
            .describe(
              `"card" is about named ${pieces}, "general" is about a mechanic or a timing, ` +
                '"policy" is about running an event rather than playing a game',
            ),
          topic: z.string().optional().describe('The topic a ruling is filed under, e.g. "abilities"'),
          query: z.string().optional().describe("Words to rank the rulings by. Omit to list them in order."),
          limit: limitField(8),
        }),
        async execute(input) {
          const limit = input.limit ?? 8
          // A query RANKS; the other three FILTER, and the two cannot combine
          // here. Ranking first and filtering after returns fewer rows than were
          // asked for, and often none, because the filter cuts into a list the
          // ranking already truncated.
          const filtered = Boolean(input.card_name || input.kind || input.topic)
          const rows =
            input.query && !filtered
              ? ((await store.searchRulings?.(input.query, { limit })) ?? [])
              : ((await store.listRulings?.({
                  cardName: input.card_name,
                  kind: input.kind,
                  topic: input.topic,
                  limit,
                })) ?? [])
          return {
            rulings: rows.map(shapeRuling),
            count: rows.length,
            // Say when a field was not used. A model that cannot tell an ignored
            // input from an applied one reads this list as "the closest rulings
            // to my query" and reports the first as the best match.
            ...(input.query && filtered
              ? {
                  note:
                    "These are filtered rulings, in corpus order. Your query ranked nothing, because a " +
                    "filter was set beside it. Call again with the query alone to rank by it.",
                }
              : {}),
          }
        },
      }),
    )

  if (profile.cards.enabled) {
    const textFields = profile.cards.textFields.map((f) => f.field)
    const readAll = textFields.length
      ? ` Read every text field it returns (${textFields.join(", ")}) — the first one alone is not the whole card.`
      : ""

    tools.push(
      defineTool({
        name: "search_cards",
        description:
          `Find ${game} ${pieces} by name, and get each one's id. This returns identity only, not ` +
          `the text: pass the ids to get_cards to read what a ${piece} does. It also matches a ` +
          `description, so a reader who describes a ${piece} instead of naming it still reaches it.`,
        inputSchema: z.object({
          query: z.string().min(1).describe(`A ${piece} name, part of one, or a description`),
          limit: limitField(8),
        }),
        async execute(input) {
          const matches = await store.searchCards(input.query, { limit: input.limit ?? 8 })
          return { matches, count: matches.length }
        },
      }),
      defineTool({
        name: "get_cards",
        description:
          `Read the full printed detail of one or more ${game} ${pieces}, by id, from search_cards. ` +
          `Pass EVERY id in one call when a question involves several ${pieces}, such as an ` +
          "interaction." +
          readAll +
          " Ground every claim about a card in this text. Never rely on memory for card text.",
        inputSchema: z.object({
          ids: z.array(z.string().min(1)).min(1).max(MAX_CARDS).describe("Card ids returned by search_cards"),
        }),
        async execute(input) {
          const found = await store.getCards(input.ids)
          const cards = found.map(flatCard)
          const missing = input.ids.filter((id) => !found.some((c) => c.id === id))
          // Name the ids that matched nothing rather than returning a short
          // list silently. A model that cannot tell "no such card" from "I
          // forgot to ask" will assert the card does not exist.
          return { cards, ...(missing.length ? { missing } : {}) }
        },
      }),
    )
  }

  return tools
}

/** Look one tool up by name. */
export function findTool(tools: RuleTool[], name: string): RuleTool | undefined {
  return tools.find((tool) => tool.name === name)
}
