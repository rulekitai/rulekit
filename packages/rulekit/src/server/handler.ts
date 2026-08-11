import { encodeEvent } from "../agent/events.ts"
import type { Turn } from "../agent/turn.ts"
import { openGate } from "../pipeline/gate.ts"
import type { Pipeline } from "../pipeline/pipeline.ts"
import { type AgentLike, streamAgent } from "../pipeline/stages/agent.ts"
import { writeBack } from "../pipeline/stages/cache.ts"
import type { Answer, AskContext, CallerIdentity, Gate } from "../pipeline/types.ts"

/**
 * One HTTP handler for the whole thing.
 *
 * It takes a web-standard Request and returns a web-standard Response, which is
 * what lets the same function mount unchanged in a Next.js route, Hono, Express
 * with an adapter, Bun, Deno, and a Cloudflare Worker. Nothing here imports a
 * web framework.
 */

/**
 * Caps on what one request may carry.
 *
 * Every one of these is paid for on every step of a tool-calling turn, so an
 * unbounded request is an unbounded bill. They are generous for a real question
 * and small enough that nothing pathological gets through.
 */
export const MAX_QUESTION_CHARS = 2000
export const MAX_HISTORY_TURNS = 20
export const MAX_TURN_CHARS = 4000

/**
 * What a reader sees when the model fails.
 *
 * The provider's own message is written for whoever holds the account. It has
 * named the hosting company, linked an account page, and told the reader to run
 * commands on a machine they do not have. Worse, a spent budget reads as
 * "Current spend: $10.00, limit: $10.00. Please contact your administrator",
 * which shows the operator's billing state to a person who asked a rules
 * question and cannot act on any of it.
 *
 * So the reader gets one plain sentence and the operator gets the detail, in
 * the server log where they can read it.
 */
export const AGENT_UNAVAILABLE = "The assistant is unavailable right now. Please try again shortly."

export type AskHandlerOptions = {
  pipeline: Pipeline
  /** The agent, for the streaming path once the earlier stages have missed. */
  agent?: AgentLike
  /** Quotas and billing. Defaults to a gate that allows everything. */
  gate?: Gate
  /** Who is asking. Return undefined for an anonymous caller. */
  identify?: (request: Request) => Promise<CallerIdentity | undefined> | CallerIdentity | undefined
  /** Stream the agent's answer as it is written. On by default. */
  stream?: boolean
  /**
   * The sentence a reader sees when the model fails. Defaults to
   * `AGENT_UNAVAILABLE`. An internal tool where every reader is an operator can
   * pass the provider's own message through by setting this to a function that
   * returns its argument.
   */
  unavailableMessage?: string | ((detail: string) => string)
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  })

/** What the browser is allowed to see. */
function clientAnswer(answer: Answer) {
  // `usage` is stripped. A reader has no use for it, and a dollar figure beside
  // an answer is a commercial detail that belongs to the operator, not to the
  // page. The gate has already recorded the full answer, so nothing is lost.
  const { usage: _usage, ...rest } = answer
  return rest
}

type AskBody = { question?: unknown; history?: unknown }

/**
 * Did another site send this request?
 *
 * A browser sends `Sec-Fetch-Site` on every request and page script cannot set
 * it, so it is the browser's own word about where a request came from. Anything
 * that is not a browser sends nothing, and is allowed.
 *
 * This closes one hole. A browser refuses to send a cross-site request carrying
 * a JSON content type until the server has answered a permission request, and
 * this handler answers only POST, so that request never arrives. An HTML form
 * needs no permission and can post a JSON body as plain text. Without this
 * check, a page a reader merely visits can spend that reader's quota here,
 * because the browser attaches their cookies.
 *
 * Nothing legitimate is lost. Reading this endpoint from another origin already
 * needs permission headers that this handler does not send, so a cross-site
 * caller cannot have been working before.
 */
function isCrossSite(request: Request): boolean {
  return request.headers.get("sec-fetch-site") === "cross-site"
}

/** Read and check the request body, or say exactly what is wrong with it. */
export function parseAskBody(
  body: AskBody,
): { ok: true; question: string; history: Turn[] } | { ok: false; error: string } {
  const question = typeof body?.question === "string" ? body.question.trim() : ""
  if (!question) return { ok: false, error: "A question is required." }
  if (question.length > MAX_QUESTION_CHARS)
    return { ok: false, error: `A question may be at most ${MAX_QUESTION_CHARS} characters.` }

  const raw = Array.isArray(body?.history) ? body.history : []
  if (raw.length > MAX_HISTORY_TURNS)
    return { ok: false, error: `A conversation may carry at most ${MAX_HISTORY_TURNS} earlier messages.` }

  const history: Turn[] = []
  for (const item of raw) {
    const turn = item as { role?: unknown; text?: unknown }
    const text = typeof turn?.text === "string" ? turn.text : ""
    if (!text.trim()) continue
    if (text.length > MAX_TURN_CHARS)
      return { ok: false, error: `An earlier message may be at most ${MAX_TURN_CHARS} characters.` }
    history.push({ role: turn.role === "assistant" ? "assistant" : "user", text })
  }
  return { ok: true, question, history }
}

export function createAskHandler(options: AskHandlerOptions) {
  const gate = options.gate ?? openGate
  const shouldStream = options.stream !== false

  /**
   * Record one answer, and never let the recording cost the answer.
   *
   * A gate that cannot reach its counter is a broken counter, not a broken
   * answer: the model has already been paid for, and on the streaming path the
   * text is already on the reader's screen. Throwing here would turn a served
   * answer into a 500 and a plain 502 into an unhandled error, so every path
   * uses this and none awaits `gate.record` directly.
   */
  const record = (ctx: AskContext, answer: Answer) =>
    gate.record(ctx, answer).catch((err) => console.error("[rulekit] gate record failed:", err))

  /**
   * Log what actually failed, and return what the reader is told.
   *
   * Every failure of the model goes through here, whichever path served the
   * request, so no provider text can reach a browser by another door.
   */
  const readerMessage = (detail: string): string => {
    console.error("[rulekit] the agent failed:", detail)
    const chosen = options.unavailableMessage ?? AGENT_UNAVAILABLE
    return typeof chosen === "function" ? chosen(detail) : chosen
  }

  return async function handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return json({ error: "Use POST." }, 405, { allow: "POST" })
    if (isCrossSite(request)) return json({ error: "This endpoint does not answer another site." }, 403)

    let body: AskBody
    try {
      body = (await request.json()) as AskBody
    } catch {
      return json({ error: "The request body is not valid JSON." }, 400)
    }

    const parsed = parseAskBody(body)
    if (!parsed.ok) return json({ error: parsed.error }, 400)

    const caller = (await options.identify?.(request)) ?? undefined

    // The gate runs BEFORE any stage, so a refusal costs nothing at all. It sees
    // the same context a stage would, built by the pipeline rather than
    // assembled here, so the two can never disagree about what a request is.
    const ctx: AskContext = options.pipeline.contextFor({
      question: parsed.question,
      history: parsed.history,
      caller,
      signal: request.signal,
    })

    const verdict = await gate.allow(ctx)
    if (!verdict.allow) {
      return json(
        { error: verdict.reason },
        verdict.status ?? 429,
        verdict.retryAfterSeconds ? { "retry-after": String(verdict.retryAfterSeconds) } : {},
      )
    }

    // The cheap stages run first, whichever path this request takes. Only a
    // genuine miss reaches the agent, and only that miss is worth streaming.
    const result = await options.pipeline.run({
      question: parsed.question,
      history: parsed.history,
      caller,
      signal: request.signal,
    })

    if (result.answer) {
      const answer = result.answer
      await record(ctx, answer)
      await writeBack(ctx, answer)
      return json(clientAnswer(answer))
    }

    if (!options.agent) {
      return json({ error: "No stage could answer this, and no agent is configured." }, 503)
    }

    const agentCtx: AskContext = ctx

    if (!shouldStream) {
      let text = ""
      let done: {
        text: string
        complete: boolean
        model?: string | null
        usage?: unknown
        latencyMs?: number
      } | null = null
      let error: string | null = null
      try {
        for await (const event of streamAgent(options.agent, agentCtx)) {
          if (event.type === "text") text = event.text
          else if (event.type === "done") done = event
          else if (event.type === "error") error = readerMessage(event.error)
        }
      } catch (err) {
        // A turn that threw still spent whatever it spent before it threw, and
        // it may already have written text. Letting the throw leave this
        // function would skip the gate below, which is the same accounting hole
        // as a turn that wrote nothing, reached from the other side.
        error = readerMessage(err instanceof Error ? err.message : String(err))
      }
      const answer: Answer = {
        text: done?.text || text,
        citations: [],
        source: "agent",
        servedBy: "agent",
        latencyMs: done?.latencyMs ?? 0,
        model: done?.model ?? null,
        usage: (done?.usage as Record<string, number | null> | null) ?? null,
        complete: done?.complete ?? false,
        ...(result.degraded.length ? { degraded: result.degraded } : {}),
      }
      // RECORDED BEFORE THE ANSWER IS JUDGED. A turn that spent its model calls
      // on tool lookups and then failed has already been charged for every one
      // of them. Returning the failure first would mean a gate counts only the
      // turns that produced text, which is a budget an asker can spend without
      // it ever counting.
      await record(agentCtx, answer)
      if (!answer.text) return json({ error: error ?? readerMessage("the agent produced no answer") }, 502)
      await writeBack(agentCtx, answer)
      return json(clientAnswer(answer))
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (line: string) => controller.enqueue(encoder.encode(line))
        let text = ""
        let complete = false
        let model: string | null = null
        let usage: Record<string, number | null> | null = null
        let latencyMs = 0
        try {
          for await (const event of streamAgent(options.agent as AgentLike, agentCtx)) {
            if (event.type === "text") text = event.text
            else if (event.type === "done") {
              text = event.text || text
              complete = event.complete
              model = event.model ?? null
              usage = event.usage ?? null
              latencyMs = event.latencyMs ?? 0
              // The browser is sent the answer without its cost, for the same
              // reason the JSON path strips it.
              write(
                encodeEvent({
                  type: "done",
                  text,
                  source: "agent",
                  complete,
                  model,
                  latencyMs,
                  usage: null,
                }),
              )
              continue
            }
            if (event.type === "error") {
              // The provider wrote this for the account holder, not for the
              // person waiting on a rules answer.
              write(encodeEvent({ type: "error", error: readerMessage(event.error) }))
              continue
            }
            write(encodeEvent(event))
          }
        } catch (err) {
          write(
            encodeEvent({
              type: "error",
              error: readerMessage(err instanceof Error ? err.message : String(err)),
            }),
          )
        } finally {
          // Bookkeeping runs after the reader has been served, and none of it
          // may throw the answer away: it is already on their screen and the
          // model has already been paid for.
          const answer: Answer = {
            text,
            citations: [],
            source: "agent",
            servedBy: "agent",
            latencyMs,
            model,
            usage,
            complete,
            ...(result.degraded.length ? { degraded: result.degraded } : {}),
          }
          // RECORDED EVEN WHEN THE TURN WROTE NOTHING, for the reason the JSON
          // path above states: those model calls were made and charged.
          // `writeBack` drops an empty or incomplete answer by itself, so a
          // failure is counted and never cached.
          await record(agentCtx, answer)
          await writeBack(agentCtx, answer)
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson",
        // A proxy that buffers turns a live answer into a long silence and then
        // a wall of text.
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    })
  }
}
