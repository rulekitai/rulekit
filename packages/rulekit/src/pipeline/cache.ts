import { normalizeQuestion } from "../corpus/text.ts"
import type { Cache, CacheEntry } from "./types.ts"

/** How long an answer stays cached, when nobody says otherwise. */
export const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7

/**
 * The cache key for a question.
 *
 * The question is folded first, so "Is X banned?" and "is x banned" share one
 * entry. Two questions that fold together are served the same answer, which is
 * why the folding is conservative rather than clever.
 *
 * `version` scopes the whole cache. Bump it when the corpus changes and every
 * stale answer becomes unreachable at once, with no key to enumerate and delete.
 */
export function answerKey(question: string, version = "1"): string {
  return `rulekit:answer:${version}:${normalizeQuestion(question)}`
}

/**
 * A cache in this process's memory.
 *
 * The default, because it needs no account, no service, and no configuration.
 * One process gets the benefit; a second process starts cold. That is the right
 * default for a project somebody just cloned, and the wrong one for a fleet, so
 * a fork points `cache` at something shared.
 *
 * `maxEntries` bounds it. Without a bound a long-running process caches every
 * question ever asked and eventually runs out of memory, which is a worse
 * failure than a cache miss.
 */
export class MemoryCache implements Cache {
  #entries = new Map<string, CacheEntry>()
  #maxEntries: number

  constructor(options: { maxEntries?: number } = {}) {
    this.#maxEntries = Math.max(1, options.maxEntries ?? 1000)
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.#entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key)
      return null
    }
    // Re-insert so the most recently read entry is the newest in insertion
    // order, which is what makes the eviction below least-recently-used.
    this.#entries.delete(key)
    this.#entries.set(key, entry)
    return entry.value as T
  }

  async set<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    this.#entries.delete(key)
    this.#entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    while (this.#entries.size > this.#maxEntries) {
      const oldest = this.#entries.keys().next()
      if (oldest.done) break
      this.#entries.delete(oldest.value)
    }
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key)
  }

  async clear(): Promise<void> {
    this.#entries.clear()
  }

  /** How many entries are held. For tests and for a status page. */
  get size(): number {
    return this.#entries.size
  }
}

/**
 * A cache that survives a restart, in a SQLite file.
 *
 * Still no account and no service, and now a redeploy does not throw away every
 * answer already paid for. Use it wherever a writable file exists.
 */
export class SqliteCache implements Cache {
  #db: import("node:sqlite").DatabaseSync
  #get: import("node:sqlite").StatementSync
  #set: import("node:sqlite").StatementSync
  #del: import("node:sqlite").StatementSync

  private constructor(db: import("node:sqlite").DatabaseSync) {
    this.#db = db
    this.#db.exec(
      "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL)",
    )
    this.#db.exec("CREATE INDEX IF NOT EXISTS cache_expiry ON cache(expires_at)")
    this.#get = this.#db.prepare("SELECT value, expires_at FROM cache WHERE key = ?")
    this.#set = this.#db.prepare(
      "INSERT INTO cache (key, value, expires_at) VALUES (?,?,?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at",
    )
    this.#del = this.#db.prepare("DELETE FROM cache WHERE key = ?")
  }

  /** Open or create a cache file. Pass ":memory:" for a throwaway one. */
  static async open(path: string): Promise<SqliteCache> {
    const { DatabaseSync } = await import("node:sqlite")
    return new SqliteCache(new DatabaseSync(path))
  }

  async get<T>(key: string): Promise<T | null> {
    const row = this.#get.get(key) as { value?: string; expires_at?: number } | undefined
    if (!row?.value) return null
    if ((row.expires_at ?? 0) <= Date.now()) {
      this.#del.run(key)
      return null
    }
    try {
      return JSON.parse(row.value) as T
    } catch {
      // A value written by an older, incompatible version. Drop it rather than
      // throwing on every read of the same key.
      this.#del.run(key)
      return null
    }
  }

  async set<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    this.#set.run(key, JSON.stringify(value), Date.now() + ttlSeconds * 1000)
  }

  async delete(key: string): Promise<void> {
    this.#del.run(key)
  }

  async clear(): Promise<void> {
    this.#db.exec("DELETE FROM cache")
  }

  /** Remove expired rows. Nothing requires this; it only reclaims disk. */
  async prune(): Promise<void> {
    this.#db.prepare("DELETE FROM cache WHERE expires_at <= ?").run(Date.now())
  }

  close(): void {
    this.#db.close()
  }
}

/** A cache that stores nothing. Useful in tests and when measuring cold cost. */
export class NoopCache implements Cache {
  async get<T>(): Promise<T | null> {
    return null
  }
  async set(): Promise<void> {}
  async delete(): Promise<void> {}
  async clear(): Promise<void> {}
}
