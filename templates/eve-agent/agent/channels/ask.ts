import { createHash, timingSafeEqual } from "node:crypto"
import { type AgentEvent, deriveLabel, encodeEvent, type TraceStep } from "@rulekitai/rulekit/agent/events"
import {
  buildMessage,
  EMPTY_USAGE,
  type RetrievedRule,
  salvageAnswer,
  stepCapReached,
  stopAtStepCap,
  type Turn,
  type UsageTotals,
  usageOrNull,
} from "@rulekitai/rulekit/agent/turn"
import { defineChannel, POST } from "eve/channels"
import type { MessageStreamEvent } from "eve/client"
import { configuredStepCap } from "../../lib/step-cap.ts"
import { appendMessageDelta } from "../../lib/stream-text"
import { addEveStepUsage, withEveSessionUsage } from "../../lib/stream-usage.ts"

/**
 * `POST /ask/stream`.
 *
 * The path is the whole application URL: a channel filename prefixes nothing,
 * so this is NOT `/ask/ask/stream`. It also stays out of `/eve/v1/*`, which Eve
 * reserves for its own session, stream, callback, and schedule routes.
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

/** True when this PROCESS is local development, decided from the build, never the request. */
function isLocalDevProcess(env = process.env): boolean {
  // Reading the caller's Host header here would hand the local exception to
  // anybody who sets it. These two are set by the build, not by a request.
  return env.NODE_ENV !== "production" && !env.VERCEL
}

/**
 * Compare two credentials in a time that does not depend on how much matched.
 *
 * `===` on two strings stops at the first character that differs, so how long
 * it takes reports how much of the secret was right, one character at a time.
 * Both sides are hashed first so the two buffers are always the same 32 bytes:
 * `timingSafeEqual` throws on a length mismatch, and a length mismatch is
 * itself something a caller could measure.
 */
function credentialsMatch(offered: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest()
  return timingSafeEqual(digest(offered), digest(expected))
}

function isAuthorized(authorization: string | null, secret: string | undefined, localDev: boolean): boolean {
  // Fails closed. The shape `if (secret && ...)` would mean an UNSET secret
  // disables the check and serves everybody, which is the opposite of what an
  // unset credential should do.
  if (!secret) return localDev
  return authorization !== null && credentialsMatch(authorization, `Bearer ${secret}`)
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
    POST("/ask/stream", async (req, { from }) => {
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
          let reader: ReadableStreamDefaultReader<MessageStreamEvent> | undefined
          try {
            // One question is one session. The transcript travels inside the
            // message, so there is nothing to resume and a fresh token per
            // request is correct.
            const session = await from(crypto.randomUUID()).send(message, { auth: null })
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
            let interrupted = false
            let capped: { text: string; complete: boolean } | null = null
            // No ceiling unless this deployment sets one. A turn ends when the
            // model stops calling tools. See NO_STEP_CAP in @rulekitai/rulekit/agent/turn
            // for why this project ships no cap of its own.
            const cap = configuredStepCap()

            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const event = value

              if (event.type === "step.completed") {
                usage = addEveStepUsage(usage, event.data.usage)
                // `answered` guards the cap: once the answer has arrived the
                // loop is only collecting cost, and cutting that short throws
                // away the price of a finished answer.
                if (!answered && cap !== null && stepCapReached(usage, cap)) {
                  capped = stopAtStepCap(finalText, running, usage.agent_steps ?? 0, cap)
                  // The committed step_cap hook stops Eve before another
                  // model call. Keep reading its cancellation and usage totals.
                }
              } else if (event.type === "session.waiting" || event.type === "session.completed") {
                usage = withEveSessionUsage(usage, event.data?.usage)
                break
              } else if (event.type === "session.failed") {
                usage = withEveSessionUsage(usage, event.data.usage)
                interrupted = true
                write({ type: "error", error: event.data.message })
                break
              } else if (event.type === "turn.cancelled") {
                interrupted = true
              } else if (event.type === "turn.failed") {
                interrupted = true
                write({ type: "error", error: event.data.message })
                // Failed turns still park with session usage. Read that
                // boundary so compaction spend and the final cost survive.
              } else if (answered) {
                // The final text arrived. Wait for the session usage boundary.
              } else if (event.type === "actions.requested") {
                for (const action of event.data.actions) {
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
                const step = steps.get(event.data.result.callId)
                if (step) {
                  step.status =
                    event.data.status === "completed"
                      ? "completed"
                      : event.data.status === "rejected"
                        ? "rejected"
                        : "failed"
                  write({ type: "step", step: { ...step } })
                }
              } else if (event.type === "message.appended") {
                running = appendMessageDelta(running, event.data)
                write({ type: "text", text: running })
              } else if (event.type === "message.completed") {
                if (event.data.finishReason === "tool-calls") {
                  // The model's preamble before a tool call. It is not the
                  // answer, so it is discarded rather than left on screen.
                  running = ""
                  write({ type: "text", text: "" })
                } else {
                  finalText = event.data.message ?? running
                  write({ type: "text", text: finalText })
                  answered = true
                }
              } else if (event.type === "turn.completed") {
                finalText = finalText || running
                write({ type: "text", text: finalText })
                answered = true
              }
            }

            const { text, complete } = capped ?? salvageAnswer(finalText, running)
            write({
              type: "done",
              text,
              source: "agent",
              complete: complete && !interrupted,
              usage: usageOrNull(usage),
              model: process.env.RULEKIT_MODEL ?? null,
              latencyMs: Date.now() - startedAt,
            })
          } catch (error) {
            write({ type: "error", error: String(error) })
          } finally {
            await reader?.cancel().catch(() => {})
            reader?.releaseLock()
            controller.close()
          }
        },
      })

      return new Response(stream, { headers: { "content-type": "application/x-ndjson" } })
    }),
  ],
})
