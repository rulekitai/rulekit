---
name: rulekit-serve
description: Mount the rulekit ask endpoint in a server, and choose its runtime settings. Use when the user wants a rules answer endpoint, or names `createAskHandler`, `createPipeline`, or `createRulesAgent`.
---

# Mount the ask endpoint

## Step 1: get the packages

```bash
pnpm add @rulekitai/rulekit
pnpm add ai                          # the agent needs it, so nearly every app does
```

Add `@rulekitai/ui` for a React interface, and read `rulekit-interface`.

**Import a subpath, such as `@rulekitai/rulekit/server/handler`.** Neither
package has a root export. Importing `@rulekitai/rulekit` throws a message that
lists the subpaths.

The application also needs a corpus. Copy one that ships:

```bash
npx rulekit init rules --corpus chess   # or demo, texas-holdem, estate-line
npx rulekit build rules                 # writes rules/corpus.db, about 65 ms
```

Riot Games owns the Riftbound corpus, so it stays in the rulekit repository:
clone the repository and copy `data/riftbound/` to use it. `rulekit-corpus`
covers writing a new corpus.

`corpus.db` is not in git. Build it after every clone, and after every change to
the JSON.

**Criterion:** `npx rulekit ask rules "what does rule 1.1 say"` prints an answer
and the words `served by static`. Inside a clone of the rulekit repository the
command is `pnpm rulekit ask data/riftbound "is Called Shot banned"`.

## Step 2: build it once per process

```ts
const store = SqliteStore.open("rules/corpus.db")
const profile = parseProfile(JSON.parse(readFileSync("rules/profile.json", "utf8")))

const pipeline = createPipeline({
  store,
  profile,
  cache: new MemoryCache(),
  stages: [exactCacheStage(), staticAnswersStage(store), glossaryStage(store)],
})

const agent = createRulesAgent({ store, profile, model: "anthropic/claude-sonnet-5" })
```

**Hold the store on `globalThis`.** A framework that reloads modules opens the
database again on every request. Read how the example application does it:
<https://github.com/rulekitai/rulekit/blob/main/examples/next-app/app/lib/rulekit.ts>

**The three stages are the free ones.** They answer a rule lookup, a ban check,
and a glossary definition from the corpus in a few milliseconds, with no model
and no account. Put them before the agent, or every question costs a model call.

## Step 3: mount the handler

```ts
export const POST = createAskHandler({ pipeline, agent })
export const maxDuration = 300     // a tool-calling turn is slow
export const runtime = "nodejs"    // the corpus is a file on disk
```

`createAskHandler` takes a `Request` and returns a `Response`. The same export
mounts in Next.js, Hono, Bun, Deno, and a Cloudflare Worker.

A short duration cuts the answer off in the middle. An edge runtime has no
filesystem, so the corpus cannot open.

### The endpoint answers in two shapes. Expect both.

| The question | Content type | The body |
|---|---|---|
| A free stage answered it | `application/json` | One object: `text`, `citations`, `source`, `servedBy`, `latencyMs`, `model` |
| Only the agent could answer it | `application/x-ndjson` | One event per line. The last is `{"type":"done", ...}` |

```jsonc
// "what is Deflect": the glossary answers, and no model runs
{"text":"…","citations":[…],"source":"glossary","servedBy":"glossary","latencyMs":9,"model":null}
```

`@rulekitai/ui` reads both. **A client written by hand must read both**, because
a client that reads lines only fails on the fast, cheap, common answer.

**Criterion, one of the two:**

- `POST {"question":"what is Deflect"}` returns one JSON object whose
  `servedBy` is a free stage.
- `POST` a question no free stage answers, such as `{"question":"how do Guard
  and Swift interact"}`, and the reply is lines of JSON whose last line has
  `"type":"done"`.

### What a reader sees when the model fails

`createAskHandler` sends the reader one plain sentence and writes the provider's
own message to the server log. A provider reports things like "Current spend:
$10.00, limit: $10.00. Contact your administrator", which is the operator's
billing state. Pass `unavailableMessage` to choose the sentence, or
`unavailableMessage: (detail) => detail` on an internal tool where every reader
is an operator.

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
| The client breaks on some answers only | It reads one shape. Read "two shapes" above. |
| `ExperimentalWarning: SQLite` on every start | Node's own notice. Call `hideSqliteExperimentalWarning()` from `@rulekitai/rulekit/sqlite-warning`. |
| `no root export` | Import the subpath, such as `@rulekitai/rulekit/server/handler`. |

## Next

- The interface: `rulekit-interface`
- Quotas or billing: `rulekit-limits`
- Reading a website when the corpus misses: `rulekit-references`
- A tool of your own: `rulekit-extend`
