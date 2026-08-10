"use client"

import { decodeEvents, type TraceStep } from "@rulekitai/agent/events"
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react"
import { type ChatMessage, classifyTurn, toHistory, toServedBy } from "./message.ts"

/**
 * The whole transport, as one hook.
 *
 * It owns the message list, the two waiting flags, and the state machine that
 * reads either shape of reply: a one-shot JSON answer from a free stage, or a
 * newline-delimited stream from the agent. The interface never learns which
 * runtime produced the stream.
 *
 * No styling, no layout, and no assumption about how anything is rendered.
 */

type AskResponseBody = {
  text?: string
  error?: string
  source?: string
  servedBy?: string
  citations?: unknown[]
  model?: string | null
  latencyMs?: number
}

/**
 * Read a reply without letting a non-JSON body hijack the failure message.
 *
 * A failing proxy or platform answers with HTML. Calling `.json()` on that
 * throws, the throw lands in the transport catch, and the reader is told there
 * is no connection when really a server returned an error. Reading the text
 * first keeps the real status.
 */
async function readBody(res: Response): Promise<AskResponseBody> {
  const raw = await res.text()
  // An empty body is a failure even on a 200. The route always sends one, so
  // nothing here is an answer, and treating it as one saves a blank turn.
  if (!raw.trim()) return { error: `The server sent an empty reply (${res.status}).` }
  try {
    return JSON.parse(raw) as AskResponseBody
  } catch {
    return { error: `The server sent a reply we could not read (${res.status}).` }
  }
}

export type AskStreamOptions = {
  /** Where to POST. Defaults to "/api/ask". */
  endpoint?: string
  /** Headers to add, for a caller-supplied model key. */
  headers?: Record<string, string> | (() => Record<string, string>)
  /** Save a completed turn. The chat it belongs to is passed in, never read live. */
  persistTurn?: (chatId: string | null, transcript: ChatMessage[], newTurn: ChatMessage[]) => Promise<void>
  /** Told about every failure, so a host app can show a notice of its own. */
  onError?: (error: { status: number; message: string; retryAfterSeconds?: number }) => void
}

export type AskStream = {
  messages: ChatMessage[]
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  /** Waiting for the first byte. */
  loading: boolean
  /** An answer is arriving. */
  streaming: boolean
  ask: (question: string, chatId?: string | null) => Promise<void>
}

const retryAfterSeconds = (header: string | null): number | undefined => {
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined
}

export function useAskStream(options: AskStreamOptions = {}): AskStream {
  const endpoint = options.endpoint ?? "/api/ask"
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState(false)

  const live = useRef({ messages, loading, streaming, options })
  // The ref is written in an effect, NOT during render. Render must stay pure:
  // React may replay or discard one, and a write there can leak from work that
  // never commits. `ask` only fires from an event, after a commit, so it always
  // reads the latest committed values.
  useEffect(() => {
    live.current = { messages, loading, streaming, options }
  })

  const ask = useCallback(
    async (question: string, chatId: string | null = null) => {
      const q = question.trim()
      const { messages: prior, loading: isLoading, streaming: isStreaming, options: opts } = live.current
      if (!q || isLoading || isStreaming) return

      const history = toHistory(prior)
      const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", text: q }
      // A stable id for the streamed placeholder, so every update targets THIS
      // message rather than "the last one".
      const streamId = crypto.randomUUID()

      // This turn's output belongs to the list only while its own messages are
      // still on screen. If a reader opens another chat mid-answer, these guards
      // make every later update a no-op, so an answer cannot bleed into the wrong
      // conversation. Saving is handled separately, against the id passed in.
      const onThisTurn = (list: ChatMessage[]) =>
        list.some((m) => m.id === userMessage.id || m.id === streamId)
      const patchStream = (patch: Partial<ChatMessage>) =>
        setMessages((list) => list.map((m) => (m.id === streamId ? { ...m, ...patch } : m)))
      const markTransient = (id: string) =>
        setMessages((list) => list.map((m) => (m.id === id ? { ...m, transient: true } : m)))
      const fail = (status: number, message: string, retry?: number) =>
        opts.onError?.({ status, message, retryAfterSeconds: retry })

      setMessages((list) => [...list, userMessage])
      setLoading(true)

      try {
        const extra = typeof opts.headers === "function" ? opts.headers() : (opts.headers ?? {})
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...extra },
          body: JSON.stringify({ question: q, history }),
        })
        const contentType = res.headers.get("content-type") ?? ""

        if (res.ok && res.body && contentType.includes("application/x-ndjson")) {
          setLoading(false)
          setStreaming(true)
          setMessages((list) =>
            onThisTurn(list) ? [...list, { id: streamId, role: "assistant", text: "", steps: [] }] : list,
          )
          const stepsById = new Map<string, TraceStep>()
          let text = ""
          let meta: Partial<ChatMessage> = {}
          let errored = false

          for await (const event of decodeEvents(res.body)) {
            if (event.type === "step") {
              stepsById.set(event.step.id, event.step)
              patchStream({ steps: [...stepsById.values()] })
            } else if (event.type === "text") {
              text = event.text
              patchStream({ text })
            } else if (event.type === "done") {
              text = event.text || text
              meta = {
                servedBy: toServedBy(event.source === "agent" ? "agent" : event.source),
                model: event.model ?? null,
                latencyMs: event.latencyMs,
              }
              patchStream({ text, ...meta })
            } else {
              errored = true
              patchStream({ text: event.error || "Something went wrong.", error: true })
              fail(500, event.error)
            }
          }

          if (!errored && text) {
            const assistant: ChatMessage = {
              id: streamId,
              role: "assistant",
              text,
              steps: [...stepsById.values()],
              ...meta,
            }
            await opts.persistTurn?.(chatId, [...prior, userMessage, assistant], [userMessage, assistant])
          } else {
            // Mark BOTH sides. Marking only the question leaves the placeholder
            // holding an empty string with neither flag, and `toHistory` keeps it:
            // the next question then counts as a follow-up and skips every free
            // stage, carrying a blank turn as its context.
            markTransient(userMessage.id)
            markTransient(streamId)
          }
        } else {
          const body = await readBody(res)
          const { failed, transient } = classifyTurn({ ok: res.ok, body })
          if (failed) {
            fail(
              res.status,
              body.error ?? `Request failed (${res.status})`,
              retryAfterSeconds(res.headers.get("retry-after")),
            )
          }
          const assistant: ChatMessage = failed
            ? {
                id: crypto.randomUUID(),
                role: "assistant",
                text: body.error ?? `Request failed (${res.status})`,
                error: true,
              }
            : {
                id: crypto.randomUUID(),
                role: "assistant",
                text: body.text ?? "(empty answer)",
                servedBy: toServedBy(body.servedBy),
                citations: body.citations,
                model: body.model ?? null,
                latencyMs: typeof body.latencyMs === "number" ? body.latencyMs : undefined,
                transient,
              }
          setMessages((list) => {
            if (!onThisTurn(list)) return list
            const updated = transient
              ? list.map((m) => (m.id === userMessage.id ? { ...m, transient: true } : m))
              : list
            return [...updated, assistant]
          })
          if (!transient) {
            await opts.persistTurn?.(chatId, [...prior, userMessage, assistant], [userMessage, assistant])
          }
        }
      } catch (error) {
        const message = `Network error: ${String(error)}`
        // Status 0 is what makes a host app say "no connection" rather than
        // blaming a server that never saw the request.
        fail(0, message)
        setMessages((list) => {
          if (!onThisTurn(list)) return list
          const updated = list.map((m) => {
            if (m.id === userMessage.id) return { ...m, transient: true }
            if (m.id === streamId) return { ...m, error: true, text: m.text || message }
            return m
          })
          if (list.some((m) => m.id === streamId)) return updated
          return [
            ...updated,
            { id: crypto.randomUUID(), role: "assistant" as const, text: message, error: true },
          ]
        })
      } finally {
        setLoading(false)
        setStreaming(false)
      }
    },
    [endpoint],
  )

  return { messages, setMessages, loading, streaming, ask }
}
