/**
 * The decisions one turn gets wrong most expensively, as pure functions.
 *
 * Nothing here opens a stream, reads an environment variable, or knows which
 * agent framework is running. That is the point: the same policy has to hold for
 * every runtime, and two copies of it drift.
 */

/** One message in the conversation so far. */
export type Turn = { role: "user" | "assistant"; text: string }

/** A rule an earlier stage already retrieved, handed to the agent to save a search. */
export type RetrievedRule = { id?: string; rule_number?: string; title?: string | null; content?: string }

/**
 * The most model calls one turn may make.
 *
 * **THERE IS NO CAP BY DEFAULT, AND THAT IS DELIBERATE.** A step cap is a cost
 * control, and a cost control is an opinion about what an answer is worth. This
 * project has no pricing model and takes no such position, for the same reason
 * its gate allows everything: the fork decides, and never has to undo a decision
 * made here.
 *
 * A turn ends on its own when the model stops calling tools and writes an
 * answer. A cap ends it EARLY, mid-thought, which is why it costs something
 * real: measured on a rules corpus of about 3,300 rules, a hard interaction
 * question spent six model calls and had not finished writing. Capping there
 * hands the reader a sentence that stops in the middle.
 *
 * Set `stepCap` when you are paying per token and want a ceiling. Then measure
 * what share of turns reach it. A cap nothing reaches costs nothing; a cap most
 * turns reach is truncating answers rather than bounding them.
 */
export const NO_STEP_CAP = null

/**
 * A cap that suits a paid deployment, if you want one to start from.
 *
 * Nothing uses this by itself. It is a number to pass to `stepCap`, offered so
 * that "pick a cap" is not a blank page. Measure before you trust it: a corpus
 * that needs deeper lookups will truncate here.
 */
export const SUGGESTED_STEP_CAP = 12

/** How many prior messages travel with a question. */
export const MAX_HISTORY_MESSAGES = 6

/** How much of one retrieved rule is worth handing over. */
const MAX_RULE_CHARS = 1200

/** How many retrieved rules travel with a question. */
const MAX_RETRIEVED_RULES = 6

/**
 * One turn's token and cost totals.
 *
 * Null means "nothing reported this", which is NOT zero. A zero cost reads as a
 * genuinely free answer and drags a measured average down; a null is omitted.
 */
export type UsageTotals = {
  prompt_tokens: number | null
  completion_tokens: number | null
  cost_usd: number | null
  cache_read_input_tokens: number | null
  cache_creation_input_tokens: number | null
  /** The model calls this turn made. This is what the step cap is checked against. */
  agent_steps: number | null
}

/** The starting totals for a turn: nothing measured yet. Frozen. */
export const EMPTY_USAGE: UsageTotals = Object.freeze({
  prompt_tokens: null,
  completion_tokens: null,
  cost_usd: null,
  cache_read_input_tokens: null,
  cache_creation_input_tokens: null,
  agent_steps: null,
})

/** Read a number off an untyped payload, or null. */
function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Add two totals where null means "unreported" rather than zero. */
function addField(current: number | null, next: number | null): number | null {
  if (next === null) return current
  return (current ?? 0) + next
}

/** One model call's reported usage, in whatever shape the runtime shows it. */
export type StepUsage = {
  inputTokens?: unknown
  outputTokens?: unknown
  promptTokens?: unknown
  completionTokens?: unknown
  cachedInputTokens?: unknown
  cacheReadInputTokens?: unknown
  cacheCreationInputTokens?: unknown
  costUsd?: unknown
  cost?: unknown
}

/**
 * Fold one model call into the turn's totals.
 *
 * Field names differ between runtimes and between provider versions, so each
 * total reads several spellings. A name nobody sends contributes nothing rather
 * than a zero.
 *
 * `agent_steps` always increments, including for a call the runtime priced at
 * nothing. The step cap is checked against this number, so a call that reported
 * no usage must still count: otherwise a run of unpriced calls loops past the
 * cap without ever reaching it.
 */
export function addStepUsage(totals: UsageTotals, usage: StepUsage | null | undefined): UsageTotals {
  const u = usage ?? {}
  return {
    prompt_tokens: addField(totals.prompt_tokens, numberOrNull(u.inputTokens ?? u.promptTokens)),
    completion_tokens: addField(totals.completion_tokens, numberOrNull(u.outputTokens ?? u.completionTokens)),
    cost_usd: addField(totals.cost_usd, numberOrNull(u.costUsd ?? u.cost)),
    cache_read_input_tokens: addField(
      totals.cache_read_input_tokens,
      numberOrNull(u.cachedInputTokens ?? u.cacheReadInputTokens),
    ),
    cache_creation_input_tokens: addField(
      totals.cache_creation_input_tokens,
      numberOrNull(u.cacheCreationInputTokens),
    ),
    agent_steps: (totals.agent_steps ?? 0) + 1,
  }
}

/**
 * Whether this turn has spent a step budget it was given.
 *
 * Always false when `cap` is null, which is the default: with no cap, a turn
 * ends when the model stops calling tools.
 */
export function stepCapReached(totals: UsageTotals, cap: number | null): boolean {
  return cap !== null && (totals.agent_steps ?? 0) >= cap
}

/** Totals worth recording, or null when the turn measured nothing at all. */
export function usageOrNull(totals: UsageTotals): UsageTotals | null {
  return totals.agent_steps === null ? null : totals
}

/**
 * The answer to return once the loop has ended.
 *
 * A stream can end after its last text chunk without ever sending a terminal
 * event. Returning "" then throws away an answer the model already wrote, and
 * downstream a client that does `text = event.text ?? text` treats "" as a
 * value, so an empty terminal event wipes the text already on screen.
 *
 * `complete` says whether a terminal event really arrived. Salvaged text is real
 * output cut mid-answer: show it to the person who asked, and never write it to
 * a shared cache, because a half-sentence served to everybody who asks the same
 * question later is worse than paying for the answer twice.
 */
export function salvageAnswer(finalText: string, running: string): { text: string; complete: boolean } {
  return { text: finalText || running, complete: Boolean(finalText) }
}

/**
 * End a turn that reached the step cap: keep what the model wrote, and say so.
 *
 * A capped answer must be visible, never silent. The reader keeps the text,
 * because a truncated answer is worth more than an empty bubble and they waited
 * for it either way. `complete` is false, so nothing caches it.
 */
export function stopAtStepCap(
  finalText: string,
  running: string,
  steps: number,
  cap: number,
): { text: string; complete: boolean } {
  const salvaged = salvageAnswer(finalText, running)
  console.warn(
    `[rulekit] step cap reached: stopping the turn after ${steps} model calls (cap ${cap}), ` +
      `returning ${salvaged.text.length} characters collected so far. ` +
      "The answer is truncated and must not be cached.",
  )
  return { text: salvaged.text, complete: false }
}

/** One retrieved rule as a single line, or null when it carries no text. */
function ruleLine(rule: RetrievedRule): string | null {
  const content = typeof rule?.content === "string" ? rule.content.trim() : ""
  if (!content) return null
  const number =
    typeof rule?.rule_number === "string" && rule.rule_number.trim() ? rule.rule_number.trim() : "?"
  const title = typeof rule?.title === "string" && rule.title.trim() ? ` ${rule.title.trim()}` : ""
  return `[${number}]${title}: ${content.slice(0, MAX_RULE_CHARS)}`
}

const RETRIEVAL_PREAMBLE = [
  "An earlier search already found these rules for this question.",
  "Read them first. Search again only if they do not answer it.",
]

/** The retrieved-rules block, or an empty list when nothing was retrieved. */
export function retrievedBlock(rules: RetrievedRule[]): string[] {
  const lines = rules
    .slice(0, MAX_RETRIEVED_RULES)
    .map(ruleLine)
    .filter((line): line is string => line !== null)
  return lines.length ? [...RETRIEVAL_PREAMBLE, "", ...lines, ""] : []
}

/**
 * Fold the question, the conversation, and any retrieved rules into one message.
 *
 * The transcript travels inside the message rather than in a durable session on
 * the server. A cheap stage can answer a first question without ever creating a
 * session, so there would be nothing to resume; the transcript the caller holds
 * is the one memory that survives every stage.
 */
export function buildMessage(question: string, history: Turn[] = [], rules: RetrievedRule[] = []): string {
  const priorTurns = (Array.isArray(history) ? history : [])
    .filter((m) => m && typeof m.text === "string" && m.text.trim())
    .slice(-MAX_HISTORY_MESSAGES)
  const retrieved = retrievedBlock(rules)
  if (priorTurns.length === 0) {
    return retrieved.length === 0 ? question : [...retrieved, `User: ${question}`].join("\n")
  }
  return [
    ...retrieved,
    "This is the conversation so far. Use it as context, then answer the user's latest message.",
    "",
    ...priorTurns.map((m) => `${m.role === "assistant" ? "Assistant" : "User"}: ${(m.text ?? "").trim()}`),
    "",
    `User: ${question}`,
  ].join("\n")
}
