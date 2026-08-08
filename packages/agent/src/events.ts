/**
 * The wire contract between an agent runtime and whatever renders its answer.
 *
 * Every runtime emits these four events, in this shape, as newline-delimited
 * JSON. That is what lets one interface drive any runtime: the browser never
 * learns which one is running, and swapping runtimes changes no client code.
 *
 * Adding a field to an event is safe. Renaming or removing one is not, because
 * a browser holding an older bundle is still reading the stream.
 */

/** One tool call, as a reader sees it while they wait. */
export type TraceStep = {
  /** Stable for the life of the call, so an update replaces rather than appends. */
  id: string
  /** The tool's real name. Diagnostic; the interface shows `label`. */
  tool: string
  /** What to show a reader, in plain words. */
  label: string
  /** A coarse group, so an interface can say "Searched 3 things". */
  kind: "searched" | "looked-up" | "read" | "ran"
  status: "running" | "completed" | "failed" | "rejected"
}

/** A tool call started, or its status changed. */
export type StepEvent = { type: "step"; step: TraceStep }

/**
 * The answer so far.
 *
 * `text` is the WHOLE answer up to this point, not the newest fragment. A
 * consumer assigns it rather than appending. That costs a little bandwidth and
 * removes a class of bug: a dropped or reordered fragment cannot corrupt the
 * text, because the next event carries the whole thing again.
 */
export type TextEvent = { type: "text"; text: string }

/** The turn ended. This is the only event that carries usage. */
export type DoneEvent = {
  type: "done"
  text: string
  /** Which layer produced this answer. "agent" when the model wrote it. */
  source: string
  /**
   * Whether the turn reached a real ending.
   *
   * False means the text is real but cut short: show it to the reader who
   * waited for it, and never write it to a cache other readers will hit.
   */
  complete: boolean
  usage?: Record<string, number | null> | null
  model?: string | null
  latencyMs?: number
}

/** The turn failed. Any text already sent stays on screen. */
export type ErrorEvent = { type: "error"; error: string }

export type AgentEvent = StepEvent | TextEvent | DoneEvent | ErrorEvent

/** Encode one event as an NDJSON line, newline included. */
export function encodeEvent(event: AgentEvent): string {
  return `${JSON.stringify(event)}\n`
}

/**
 * Read an NDJSON stream into events.
 *
 * A chunk boundary can land anywhere, including inside a JSON object, so the
 * tail of a chunk is held until its newline arrives. A line that does not parse
 * is skipped rather than throwing: one corrupt line must not end a turn that is
 * still producing a good answer.
 */
export async function* decodeEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<AgentEvent> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf("\n")
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line) {
          try {
            yield JSON.parse(line) as AgentEvent
          } catch {
            // A partial or malformed line. Skip it and keep reading.
          }
        }
        newline = buffer.indexOf("\n")
      }
    }
    // A final line with no trailing newline is still an event.
    const rest = buffer.trim()
    if (rest) {
      try {
        yield JSON.parse(rest) as AgentEvent
      } catch {
        // Nothing to recover.
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/** Turn a tool name and its input into something a reader can follow. */
export function deriveLabel(
  toolName: string,
  input?: Record<string, unknown>,
): { label: string; kind: TraceStep["kind"] } {
  const subject = firstString(input, ["query", "card_name", "rule_number", "slug", "format"])
  const suffix = subject ? `: ${subject}` : ""
  switch (toolName) {
    case "search_all":
    case "search_rules":
      return { label: `Searched the rules${suffix}`, kind: "searched" }
    case "search_terms":
      return { label: `Looked up a term${suffix}`, kind: "looked-up" }
    case "get_rule":
      return { label: `Read a rule${suffix}`, kind: "looked-up" }
    case "get_rule_context":
      return { label: "Read the surrounding rules", kind: "read" }
    case "list_errata":
      return { label: `Checked card changes${suffix}`, kind: "looked-up" }
    case "list_banlist":
      return { label: `Checked the banned list${suffix}`, kind: "looked-up" }
    case "list_patch_notes":
      return { label: "Checked the update notes", kind: "looked-up" }
    case "list_rulebooks":
      return { label: "Listed the rulebooks", kind: "read" }
    case "list_sections":
      return { label: "Read the table of contents", kind: "read" }
    case "search_cards":
      return { label: `Searched cards${suffix}`, kind: "searched" }
    case "get_cards":
      return { label: "Read card text", kind: "looked-up" }
    default:
      return { label: toolName.replace(/_/g, " "), kind: "ran" }
  }
}

function firstString(input: Record<string, unknown> | undefined, keys: string[]): string {
  if (!input) return ""
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}
