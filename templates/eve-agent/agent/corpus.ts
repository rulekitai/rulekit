import { resolve } from "node:path"
import { SqliteStore } from "@rulekit/corpus/sqlite-store"

/**
 * The corpus, opened once for the process.
 *
 * Deliberately NOT under `agent/tools/` or `agent/channels/`: Eve reads every
 * file in those directories as a tool or a channel, and a helper module there
 * fails the build.
 */

export const CORPUS_DIR = resolve(process.cwd(), "..", "..", process.env.RULEKIT_CORPUS ?? "data/riftbound")

let store: SqliteStore | null = null

export function corpusStore(): SqliteStore {
  if (!store) store = SqliteStore.open(resolve(CORPUS_DIR, "corpus.db"))
  return store
}
