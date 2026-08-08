import type { Profile } from "./profile.ts"
import { BASE_INSTRUCTIONS as BASE } from "./prose.ts"

/**
 * The instructions that hold for every rulebook.
 *
 * Authored as Markdown in `src/instructions/base.md` and compiled into a module
 * by `scripts/build-prose.mjs`. It is NOT read from disk at run time: a bundler
 * cannot see a path a module builds from `import.meta.url`, so the file is left
 * out of the bundle and every question then fails on a missing file, after
 * deployment and never before.
 */

/** Join non-empty blocks with a blank line between them. */
const block = (...parts: (string | null)[]) => parts.filter(Boolean).join("\n\n")

function identitySection(profile: Profile): string {
  const { name, description } = profile.game
  if (profile.identity) return `# Identity\n\n${profile.identity}`
  const what = description ? ` ${description}` : ""
  return (
    `# Identity\n\n` +
    `You are a ${name} rules assistant.${what} You answer questions about its rules, ` +
    `its defined terms, changes to its cards, which cards are banned or restricted, ` +
    `and the cards themselves. You answer only from what the tools return. ` +
    `If a question is not about ${name}, say so and offer what you do cover.`
  )
}

function vocabularySection(profile: Profile): string | null {
  if (!profile.vocabulary.length) return null
  const lines = profile.vocabulary.map((rule) => {
    const avoid = rule.insteadOf.length
      ? ` Never say ${rule.insteadOf.map((w) => `"${w}"`).join(" or ")}.`
      : ""
    const means = rule.means ? ` ${rule.means}` : ""
    return `- Say **"${rule.use}"**.${avoid}${means}`
  })
  return block(
    "# Vocabulary",
    "This game names things its own way. Use its words, in every answer.",
    lines.join("\n"),
  )
}

function cardsSection(profile: Profile): string | null {
  const cards = profile.cards
  if (!cards.enabled) return null

  const parts: string[] = ["# Cards"]
  parts.push(
    "To read a card's printed text, search for the name to get its id, then fetch the card by id. " +
      "Pass every id in one call when a question names more than one card.",
  )

  if (cards.textFields.length) {
    parts.push(
      "A card can print text in more than one place. Read every one of these before you conclude " +
        "a card does not say something:",
    )
    parts.push(cards.textFields.map((f) => `- \`${f.field}\` — ${f.describes}`).join("\n"))
  }

  if (cards.linkScheme) {
    parts.push(
      `## Name a card as a link\n\n` +
        `The first time you name a card you looked up, write it as a Markdown link:\n\n` +
        `    [Card Name](${cards.linkScheme}:<image path>)\n\n` +
        `Use the exact image path the tool returned for that card. The link shows the card when a ` +
        `reader hovers or taps the name.\n\n` +
        `Link a card ONLY when you have its image path from a tool. Two things are never links: ` +
        `a card with no image path, and anything that is not a card. A rule, a keyword, an ability ` +
        `and a defined term are all written as plain text. A link with an empty path renders as ` +
        `nothing and tells the reader you looked something up that you did not.`,
    )
    if (cards.maxInlineImages > 0) {
      parts.push(
        `## Show the card the question is about\n\n` +
          `For the one card a question is really about, also show its image, with a leading \`!\`:\n\n` +
          `    ![Card Name](${cards.linkScheme}:<image path>)\n\n` +
          `Place it right after your first sentence about that card. Show at most ` +
          `${cards.maxInlineImages} image${cards.maxInlineImages === 1 ? "" : "s"} in one answer, ` +
          `never the same card twice, and only a card you looked up that has an image path. ` +
          `The image is extra: the first mention of every card is still a link.`,
      )
    }
  }

  return parts.join("\n\n")
}

function tokensSection(profile: Profile): string | null {
  const tokens = profile.tokens
  if (!tokens) return null
  const groups = tokens.groups.map((g) => `- ${g.label}: ${g.examples.map((e) => `\`${e}\``).join(" ")}`)
  return block(
    "# Symbols",
    `Write each cost, symbol, and keyword as a bracket token, as plain inline text: ${tokens.syntax}. ` +
      "Do not put a token in backticks or a code block. A token in backticks renders as text, not as a symbol.\n\n" +
      "This applies to YOUR OWN sentences only. Inside a quotation, reproduce what the tool returned " +
      "exactly, symbols and abbreviations included. Expanding an abbreviation inside quotation marks " +
      "makes the quotation false.",
    groups.length ? `Use these exact spellings:\n\n${groups.join("\n")}` : null,
  )
}

function scopeSection(profile: Profile): string | null {
  const { answer, refuse } = profile.scope
  if (!answer.length && !refuse.length) return null
  return block(
    "# Scope for this game",
    answer.length ? `Answer these:\n\n${answer.map((t) => `- ${t}`).join("\n")}` : null,
    refuse.length ? `Also decline these:\n\n${refuse.map((t) => `- ${t}`).join("\n")}` : null,
  )
}

export type BuildInstructionsOptions = {
  /**
   * Procedures to include in full.
   *
   * A runtime with its own skill mechanism, such as Eve, loads these on demand
   * and should pass none here. The AI SDK runtime has no such mechanism, and
   * inlining is the better trade for it anyway: loading a skill would cost one
   * of a turn's few model calls, while inlined text is a stable prefix that
   * prompt caching makes almost free after the first question.
   */
  skills?: { name: string; body: string }[]
}

/**
 * Build the whole system prompt for one game.
 *
 * The identity comes first, because it is what a model reads to decide whether a
 * question is in scope at all. The universal grounding rules come next, and the
 * game's own details come last so a profile can sharpen a rule but never quietly
 * remove one.
 */
export function buildInstructions(profile: Profile, options: BuildInstructionsOptions = {}): string {
  const skills = options.skills ?? []
  return block(
    identitySection(profile),
    BASE,
    vocabularySection(profile),
    cardsSection(profile),
    tokensSection(profile),
    scopeSection(profile),
    skills.length ? `# Procedures\n\n${skills.map((s) => s.body).join("\n\n---\n\n")}` : null,
    profile.extraGuidance.length ? `# Also\n\n${profile.extraGuidance.join("\n\n")}` : null,
    profile.cards.enabled
      ? `Every tool is already scoped to ${profile.game.name}. Do not ask the reader which game they mean.`
      : null,
  )
}

/** The base instructions on their own, for anybody composing a prompt by hand. */
export function baseInstructions(): string {
  return BASE
}
