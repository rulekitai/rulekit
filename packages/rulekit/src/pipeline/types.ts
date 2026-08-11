import type { Profile } from "../agent/profile.ts"
import type { RetrievedRule, Turn } from "../agent/turn.ts"
import type { RuleStore } from "../corpus/store.ts"

/** One citation an answer rests on. Shape is per-stage; the interface shows it. */
export type Citation = Record<string, unknown>

/** One served answer. */
export type Answer = {
  text: string
  citations: Citation[]
  /** Where the facts came from, e.g. "banlist", "glossary", "agent". */
  source: string
  /** Which stage answered THIS request, e.g. "cache", "static", "agent". */
  servedBy: string
  latencyMs: number
  model: string | null
  /** Stages that threw on the way here. Absent when none did. */
  degraded?: string[]
  /**
   * What this request cost.
   *
   * Request-scoped, so it is never cached: a cached answer that carried a cost
   * would report the same spend again on every later free hit of it.
   */
  usage?: Record<string, number | null> | null
  /**
   * Whether the answer reached a real ending.
   *
   * False means the text is real but cut short. Show it to the person who
   * waited; never write it to a cache other people will read.
   */
  complete?: boolean
}

/** Everything a stage may read about one request. */
export type AskContext = {
  question: string
  history: Turn[]
  /** True when history is non-empty. A follow-up depends on context. */
  isFollowUp: boolean
  store: RuleStore
  profile: Profile
  cache: Cache
  /**
   * Scopes every cache key.
   *
   * It belongs to the request rather than to one stage, because more than one
   * place writes an answer: the cache stage reads, and the handler and two
   * cheap stages write. A version held by the reader alone is read at the new
   * number and written at the old one, so bumping it empties the cache for good
   * instead of once.
   */
  cacheVersion: string
  /** Rules an earlier stage found. A later stage passes them on to save a search. */
  retrieved: RetrievedRule[]
  /** Who is asking, when the host app knows. Opaque here. */
  caller?: CallerIdentity
  signal?: AbortSignal
}

/**
 * One layer of the answer pipeline.
 *
 * A stage returns an answer or null. Null means "I could not answer this", and
 * the next stage tries. A stage that THROWS is recorded as degraded and treated
 * as null, because every stage before the last is an optimisation: the agent can
 * answer anything they can, so a broken one must cost latency and never the
 * answer itself.
 */
export type Stage = {
  name: string
  /** Skip this stage when it returns false. Cheaper than running and returning null. */
  when?: (ctx: AskContext) => boolean
  run: (ctx: AskContext) => Promise<Answer | null>
}

/** A cached value with its own expiry. */
export type CacheEntry<T = unknown> = { value: T; expiresAt: number }

/**
 * Somewhere to keep an answer.
 *
 * The default keeps it in memory, which needs no account and no service. A fork
 * that runs more than one process points this at something shared.
 */
export interface Cache {
  get<T = unknown>(key: string): Promise<T | null>
  set<T = unknown>(key: string, value: T, ttlSeconds: number): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}

/** Whatever the host app knows about who is asking. This project reads none of it. */
export type CallerIdentity = { id?: string; [key: string]: unknown }

/** What a gate decided about one request. */
export type GateVerdict =
  | { allow: true }
  | {
      allow: false
      /** What the reader is told. */
      reason: string
      /** The HTTP status to answer with. */
      status?: number
      /** Seconds to wait, for a limit that will lift. */
      retryAfterSeconds?: number
    }

/**
 * The hook a fork uses for quotas, rate limits, and billing.
 *
 * **This project ships no pricing model and no limits.** The default gate allows
 * everything and records nothing. That is the whole point of this interface: a
 * fork adds its own charging without patching anything here, and this repository
 * never has to take a position on what an answer costs.
 *
 * `allow` runs before the pipeline, so a refusal costs nothing. `record` runs
 * after, with the answer, which is where a fork counts usage or bills.
 */
export interface Gate {
  allow(ctx: AskContext): Promise<GateVerdict>
  record(ctx: AskContext, answer: Answer): Promise<void>
}

/** How the runtime finds a model credential for one request. */
export interface CredentialResolver {
  /** A key for this request, or null when the runtime should use its own config. */
  resolve(request: Request | null, ctx?: AskContext): Promise<string | null>
}
