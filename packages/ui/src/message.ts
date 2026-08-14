import type { TraceStep } from "@rulekitai/rulekit/agent/events"

/** One message on screen. */
export type ChatMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  /** The tool calls a reader watched happen. */
  steps?: TraceStep[]
  citations?: unknown[]
  /** Which stage answered, for a small label under the message. */
  servedBy?: ServedBy
  /**
   * Where the facts came from, which is NOT the stage that served them.
   *
   * A cache hit reports `servedBy: "cache"` and `source: "agent"` when a model
   * wrote the answer the first time. Reading only `servedBy` then labels a
   * model's words as read from the rules data, on every repeat question.
   */
  source?: string
  model?: string | null
  latencyMs?: number
  /** The message reports a failure rather than an answer. */
  error?: boolean
  /**
   * The message stays on screen but is not part of the conversation.
   *
   * A question nothing answered must not come back as history. The next
   * question would then count as a follow-up, which skips every free stage and
   * goes straight to the model, carrying an apology as its context.
   */
  transient?: boolean
}

/** Every stage that can serve an answer. A string off the wire is narrowed to this. */
export const SERVED_BY = ["cache", "static", "glossary", "semantic", "cheap", "agent"] as const
export type ServedBy = (typeof SERVED_BY)[number]

export function toServedBy(value: unknown): ServedBy | undefined {
  return typeof value === "string" && (SERVED_BY as readonly string[]).includes(value)
    ? (value as ServedBy)
    : undefined
}

/**
 * Did a model write this answer, or did the corpus?
 *
 * The strongest claim this project makes is that most questions never reach a
 * model. A disclaimer that says "Written by an AI" under a row read straight
 * out of the rules data states the opposite, and the trace line above it
 * disagrees with it on the same screen. This is what a host app tests to write
 * a disclaimer that stays true.
 *
 * Pass `message.source` as well as `message.servedBy`. A cache hit reports
 * `servedBy: "cache"` and keeps `source: "agent"`, so reading the stage alone
 * labels a model's own words as read from the rules data, on every repeat
 * question. The origin wins when both are present.
 */
export function answerSource(servedBy: string | undefined, source?: string): "rules" | "model" {
  // The ORIGIN decides, and the stage that served it does not. A cached answer
  // a model wrote is still a model's answer, and `servedBy` reads "cache".
  const origin = source ?? servedBy
  return origin === "agent" || origin === "cheap" ? "model" : "rules"
}

/** One site read while answering, named so a disclaimer can list it. */
export type ReadSource = { name: string; url: string; official: boolean }

/**
 * The sites outside the rules data that this answer read, if any.
 *
 * Read from the trace rather than from the answer's prose. The model writes the
 * prose, and the model is the thing a reader is checking, so a disclaimer built
 * from a sentence the model chose to write proves nothing. A step carries its
 * source because the tool that did the reading put it there.
 *
 * One entry per site, not per page: a reader wants to know which sites were
 * consulted, and three pages of one site is still one site to weigh.
 */
export function readSources(steps: TraceStep[] | undefined): ReadSource[] {
  const bySite = new Map<string, ReadSource>()
  for (const step of steps ?? []) {
    if (step.source && !bySite.has(step.source.name)) bySite.set(step.source.name, step.source)
  }
  return [...bySite.values()]
}

/**
 * The messages that count as conversation.
 *
 * One pass, dropping and transforming together. A turn nothing answered is
 * dropped here, which is the whole reason `transient` exists.
 */
export function toHistory(messages: ChatMessage[]): { role: "user" | "assistant"; text: string }[] {
  return messages.flatMap((message) =>
    message.transient || message.error || !message.text.trim()
      ? []
      : [{ role: message.role, text: message.text }],
  )
}

/** What one completed turn produced, and whether it is worth keeping. */
export function classifyTurn(input: { ok: boolean; body: { text?: string; error?: string } }): {
  failed: boolean
  transient: boolean
} {
  if (!input.ok || input.body?.error) return { failed: true, transient: true }
  const text = input.body?.text ?? ""
  // A successful response with no text is not an answer. Treating it as one
  // saves a blank turn that later reads as context.
  if (!text.trim()) return { failed: false, transient: true }
  return { failed: false, transient: false }
}
