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
