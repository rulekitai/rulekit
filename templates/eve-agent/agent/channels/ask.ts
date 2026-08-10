import { type AgentEvent, deriveLabel, encodeEvent, type TraceStep } from "@rulekitai/agent/events"
import {
  addStepUsage,
  buildMessage,
  EMPTY_USAGE,
  type RetrievedRule,
  salvageAnswer,
  stepCapReached,
  stopAtStepCap,
  type Turn,
  type UsageTotals,
  usageOrNull,
} from "@rulekitai/agent/turn"
import { defineChannel, POST } from "eve/channels"

/**
 * `POST /eve/v1/ask/stream`.
 *
 * It re-emits Eve's session events as the same four events every runtime here
 * emits, so the browser never learns which runtime answered. That shared
 * contract is the whole reason two runtimes can exist at all.
 *
 * NOT A PUBLIC ENDPOINT. Set `RULEKIT_INTERNAL_SECRET` on any deployment. The
 * check below fails CLOSED: with no secret configured it serves local
 * development only. Every cost control lives in the caller, so an open URL here
 * is an unmetered model turn per request with nothing counting them.
 */

/** Eve reaches skills through a tool of its own. A reader has no use for seeing it. */
const HIDDEN_TOOLS = new Set(["connection_search", "load_skill"])

type StreamEvent = { type?: string; data?: Record<string, unknown> }
type ToolCall = { kind?: string; callId?: string; toolName?: string; input?: Record<string, unknown> }

/** True when this PROCESS is local development, decided from the build, never the request. */
function isLocalDevProcess(env = process.env): boolean {
  // Reading the caller's Host header here would hand the local exception to
  // anybody who sets it. These two are set by the build, not by a request.
  return env.NODE_ENV !== "production" && !env.VERCEL
}

function isAuthorized(authorization: string | null, secret: string | undefined, localDev: boolean): boolean {
  // Fails closed. The shape `if (secret && ...)` would mean an UNSET secret
  // disables the check and serves everybody, which is the opposite of what an
  // unset credential should do.
  if (!secret) return localDev
  return authorization === `Bearer ${secret}`
}

function rejectUnauthorized(req: Request): Response | null {
  const allowed = isAuthorized(
    req.headers.get("authorization"),
    process.env.RULEKIT_INTERNAL_SECRET,
    isLocalDevProcess(),
  )
  return allowed ? null : new Response("Unauthorized", { status: 401 })
}

export default defineChannel({
  routes: [
    POST("/eve/v1/ask/stream", async (req, { send }) => {
      const denied = rejectUnauthorized(req)
      if (denied) return denied

      let body: { question?: string; history?: Turn[]; rules?: RetrievedRule[] }
      try {
        body = (await req.json()) as typeof body
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 })
      }
      const question = body?.question?.trim()
      if (!question) return Response.json({ error: "question required" }, { status: 400 })

      const message = buildMessage(question, body.history ?? [], body.rules ?? [])
      const startedAt = Date.now()
      const encoder = new TextEncoder()

      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const write = (event: AgentEvent) => controller.enqueue(encoder.encode(encodeEvent(event)))
          let reader: ReadableStreamDefaultReader | undefined
          try {
            // One question is one session. The transcript travels inside the
            // message, so there is nothing to resume and a fresh token per
            // request is correct.
            const session = await send(message, { auth: null, continuationToken: crypto.randomUUID() })
            reader = (await session.getEventStream()).getReader()

            const steps = new Map<string, TraceStep>()
            let running = ""
            let finalText = ""
            let usage: UsageTotals = EMPTY_USAGE
            // Set once the answer is settled. The loop keeps reading past it to
            // collect the last step's usage, which Eve reports AFTER the message
            // it belongs to. Stopping at the message loses the most expensive
            // step's cost, every time.
            let answered = false
            let capped: { text: string; complete: boolean } | null = null
            // No ceiling unless this deployment sets one. A turn ends when the
            // model stops calling tools. See NO_STEP_CAP in @rulekitai/agent/turn
            // for why this project ships no cap of its own.
            const cap = process.env.RULEKIT_STEP_CAP ? Number(process.env.RULEKIT_STEP_CAP) : null

            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const event = value as StreamEvent
              const data = event.data ?? {}

              if (event.type === "step.completed") {
                usage = addStepUsage(usage, data.usage as never)
                // `answered` guards the cap: once the answer has arrived the
                // loop is only collecting cost, and cutting that short throws
                // away the price of a finished answer.
                if (!answered && cap !== null && stepCapReached(usage, cap)) {
                  capped = stopAtStepCap(finalText, running, usage.agent_steps ?? 0, cap)
                  await reader.cancel().catch(() => {})
                  break
                }
              } else if (answered) {
                if (event.type === "turn.completed" || event.type === "session.completed") break
                if (event.type === "turn.failed" || event.type === "session.failed") break
              } else if (event.type === "actions.requested") {
                for (const action of (Array.isArray(data.actions) ? data.actions : []) as ToolCall[]) {
                  if (action.kind !== "tool-call" || !action.callId || !action.toolName) continue
                  if (HIDDEN_TOOLS.has(action.toolName)) continue
                  const { label, kind } = deriveLabel(action.toolName, action.input)
                  const step: TraceStep = {
                    id: action.callId,
                    tool: action.toolName,
                    label,
                    kind,
                    status: "running",
                  }
                  steps.set(action.callId, step)
                  write({ type: "step", step })
                }
              } else if (event.type === "action.result") {
                const result = data.result as { callId?: string } | undefined
                const step = result?.callId ? steps.get(result.callId) : undefined
                if (step) {
                  step.status =
                    data.status === "completed"
                      ? "completed"
                      : data.status === "rejected"
                        ? "rejected"
                        : "failed"
                  write({ type: "step", step: { ...step } })
                }
              } else if (event.type === "message.appended") {
                running = (data.messageSoFar as string) ?? running
                write({ type: "text", text: running })
              } else if (event.type === "message.completed") {
                if (data.finishReason === "tool-calls") {
                  // The model's preamble before a tool call. It is not the
                  // answer, so it is discarded rather than left on screen.
                  running = ""
                  write({ type: "text", text: "" })
                } else {
                  finalText = (data.message as string) ?? running
                  write({ type: "text", text: finalText })
                  answered = true
                }
              } else if (event.type === "turn.completed") {
                finalText = finalText || running
                write({ type: "text", text: finalText })
                break
              } else if (event.type === "turn.failed" || event.type === "session.failed") {
                write({ type: "error", error: (data.message as string) ?? "the turn failed" })
                // BREAK, not return. A failed turn has usually already run
                // several steps and every one was charged. Returning here skips
                // the done event below, which is the only one carrying usage, so
                // a failure loop burning real money would report no spend at all.
                break
              }
            }

            const { text, complete } = capped ?? salvageAnswer(finalText, running)
            write({
              type: "done",
              text,
              source: "agent",
              complete,
              usage: usageOrNull(usage),
              model: process.env.RULEKIT_MODEL ?? null,
              latencyMs: Date.now() - startedAt,
            })
          } catch (error) {
            write({ type: "error", error: String(error) })
          } finally {
            reader?.releaseLock()
            controller.close()
          }
        },
      })

      return new Response(stream, { headers: { "content-type": "application/x-ndjson" } })
    }),
  ],
})
