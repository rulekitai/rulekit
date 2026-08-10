---
name: rulekit-serve
description: Install rulekit and mount its ask endpoint in a server. Covers forking versus copying the packages, wiring the store, the profile, the free stages and the agent, and the runtime settings a tool-calling turn needs. Use when the user wants to add a rules answer endpoint, mount `createAskHandler`, wire `createPipeline` or `createRulesAgent`, or asks how to install rulekit when it is not on npm.
---

# Mount the ask endpoint

## Step 1: get the packages

Install them from npm, in their own application:

```bash
pnpm add @rulekitai/rulekit
pnpm add ai                          # a peer dependency of the agent
```

Add `@rulekitai/ui` for a React interface. Read the
`rulekit-interface` skill for the three levels.

Their application also needs a corpus. Copy one of the four public-domain
corpora from the repository, or write one. The `rulekit-corpus` skill covers a
new one.

```bash
pnpm rulekit build path/to/corpus    # writes corpus.db, about 65 ms
```

`corpus.db` is not in git. Build it after every clone, and after every change to
the JSON.

**Criterion:** `pnpm rulekit ask data/riftbound "is Called Shot banned"` prints
an answer and the words `served by static`.

## Step 2: wire it once per process

```ts
const store = SqliteStore.open("data/riftbound/corpus.db")
const profile = parseProfile(JSON.parse(readFileSync("data/riftbound/profile.json", "utf8")))

const pipeline = createPipeline({
  store,
  profile,
  cache: new MemoryCache(),
  stages: [exactCacheStage(), staticAnswersStage(store), glossaryStage(store)],
})

const agent = createRulesAgent({ store, profile, model: "anthropic/claude-sonnet-5" })
```

**Build this once and keep it.** A framework that reloads modules will reopen
the database on every request. Hold it on `globalThis`, as
`examples/next-app/app/lib/rulekit.ts` does.

**The three stages are the free ones.** They answer a rule lookup, a legality
question, and a keyword definition from the corpus, in a few milliseconds, with
no model and no account. Put them before the agent, or every question costs a
model call.

## Step 3: mount the handler

```ts
export const POST = createAskHandler({ pipeline, agent })
export const maxDuration = 300     // a tool-calling turn is slow
export const runtime = "nodejs"    // the corpus is a file on disk
```

`createAskHandler` takes a `Request` and returns a `Response`. The same export
mounts in Next.js, Hono, Bun, Deno, and a Cloudflare Worker.

**Both settings matter.** A short duration cuts the answer off in the middle. An
edge runtime has no filesystem, so the corpus cannot open.

**Criterion:** a `POST` of `{"question":"what is Deflect"}` returns lines of
JSON, and the last line has `"type":"done"`.

## Step 4: choose the model

The model is one `"provider/model"` string. Change the provider with an
environment variable and no code.

```bash
AI_GATEWAY_API_KEY=...            # or the variable your provider reads
RULEKIT_MODEL=anthropic/claude-sonnet-5
```

## When something fails

| What you see | Why |
|---|---|
| `unable to open database file` | Run `rulekit build` first. |
| The answer stops in the middle | `maxDuration` is too low. |
| `SqliteStore is not a function` on the edge | Set `runtime = "nodejs"`. |
| Every question calls the model | The free stages are missing from `stages`. |

## Next

- The interface: `rulekit-interface`
- Quotas or billing: `rulekit-limits`
