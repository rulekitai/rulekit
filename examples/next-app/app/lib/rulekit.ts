import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { type Profile, parseProfile } from "@rulekitai/rulekit/agent/profile"
import { createRulesAgent, type RulesAgent } from "@rulekitai/rulekit/agent/runtime"
import { SqliteStore } from "@rulekitai/rulekit/corpus/sqlite-store"
import { MemoryCache } from "@rulekitai/rulekit/pipeline/cache"
import { createPipeline, type Pipeline } from "@rulekitai/rulekit/pipeline/pipeline"
import { exactCacheStage } from "@rulekitai/rulekit/pipeline/stages/cache"
import { glossaryStage } from "@rulekitai/rulekit/pipeline/stages/glossary"
import { staticAnswersStage } from "@rulekitai/rulekit/pipeline/stages/static"

/**
 * Everything wired together, once per server process.
 *
 * The corpus is a file on disk, so the whole thing starts in milliseconds and
 * needs no database, no cache service, and no account beyond one model key.
 */

/**
 * Which corpus to serve.
 *
 * `data/riftbound` ships with the repository. `data/demo` is the invented game
 * the tests read. Point this at your own once you have one.
 */
const CORPUS_DIR = resolve(process.cwd(), "..", "..", process.env.RULEKIT_CORPUS ?? "data/riftbound")

/**
 * The model.
 *
 * A plain "provider/model" string routes through the AI SDK's gateway, so
 * changing provider is one environment variable and no code. Nothing in this
 * project requires a particular one; this default is a starting point.
 */
const MODEL = process.env.RULEKIT_MODEL ?? "anthropic/claude-sonnet-5"

type Wiring = { store: SqliteStore; profile: Profile; pipeline: Pipeline; agent: RulesAgent }

/**
 * Built once and reused.
 *
 * Next.js reloads a module on every change in development, and rebuilding the
 * agent per request would reopen the database each time. The handle is kept on
 * `globalThis` so a reload does not leak one.
 */
const cached = globalThis as typeof globalThis & { __rulekit?: Wiring }

export function rulekit(): Wiring {
  if (cached.__rulekit) return cached.__rulekit

  const store = SqliteStore.open(resolve(CORPUS_DIR, "corpus.db"))
  const profile = parseProfile(JSON.parse(readFileSync(resolve(CORPUS_DIR, "profile.json"), "utf8")))

  const pipeline = createPipeline({
    store,
    profile,
    cache: new MemoryCache(),
    // The free stages, in order of cost. Each one answers a shape of question
    // outright, so only a genuine miss reaches the model.
    stages: [exactCacheStage(), staticAnswersStage(store), glossaryStage(store)],
  })

  const agent = createRulesAgent({ store, profile, model: MODEL })

  cached.__rulekit = { store, profile, pipeline, agent }
  return cached.__rulekit
}
