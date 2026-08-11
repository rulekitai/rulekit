# @rulekitai/rulekit

A grounded rules assistant: the corpus, the agent, the answer pipeline, the HTTP
handler, and the `rulekit` command.

It answers questions from your own rulebook, it quotes that rulebook, and it
gives the source of each claim. When the corpus has no answer, it says so.

Part of [rulekit](https://github.com/rulekitai/rulekit).

## Install

```bash
pnpm add @rulekitai/rulekit
pnpm add ai
```

Install `ai` unless you serve rule lookups alone. The free stages answer a rule
number, a legality question, and a keyword definition by reading rows, and the
agent answers every other shape of question. So an assistant that people talk
to needs the agent, and only a lookup service does not.

## Use

```bash
npx rulekit init my-game       # copy a corpus to start from
npx rulekit validate my-game   # names every problem
npx rulekit build my-game      # writes my-game/corpus.db
npx rulekit ask my-game "what is Swift" --json   # one object, for a script
npx rulekit --version
```

Four corpora travel inside this package: `demo` (the default), `chess`,
`texas-holdem`, and `estate-line`. Name one with `--corpus`:

```bash
npx rulekit init my-game --corpus chess
```

All four carry a CC0 1.0 dedication, so you may copy one and sell what you
build on it. The Riftbound corpus is not here. Riot Games owns that data and
permits non-commercial use only, so it stays in
[the repository](https://github.com/rulekitai/rulekit/tree/main/data/riftbound).

```ts
import { SqliteStore } from "@rulekitai/rulekit/corpus/sqlite-store"
import { parseProfile } from "@rulekitai/rulekit/agent/profile"
import { createRulesAgent } from "@rulekitai/rulekit/agent/runtime"
import { createPipeline } from "@rulekitai/rulekit/pipeline/pipeline"
import { staticAnswersStage } from "@rulekitai/rulekit/pipeline/stages/static"
import { glossaryStage } from "@rulekitai/rulekit/pipeline/stages/glossary"
import { createAskHandler } from "@rulekitai/rulekit/server/handler"

const store = SqliteStore.open("my-game/corpus.db")
const profile = parseProfile(myProfileJson)

export const POST = createAskHandler({
  pipeline: createPipeline({
    store,
    profile,
    stages: [staticAnswersStage(store), glossaryStage(store)],
  }),
  agent: createRulesAgent({ store, profile, model: "anthropic/claude-sonnet-5" }),
})
```

`createAskHandler` returns a plain function from `Request` to `Response`, so the
same export works in Next.js, Hono, Bun, Deno, and a Cloudflare Worker.

The free stages answer a rule number, a legality question, and a keyword by
reading rows, so they cost no model call. Only a question that all of them miss
reaches the agent.

## The subpaths

| Prefix | What it holds |
|---|---|
| `@rulekitai/rulekit/corpus/*` | The JSON schema, the SQLite builder, and one read interface |
| `@rulekitai/rulekit/agent/*` | Tools, instructions, procedures, and an AI SDK runtime |
| `@rulekitai/rulekit/pipeline/*` | The stages, the cache, the permission check, and credentials |
| `@rulekitai/rulekit/server/*` | The HTTP handler |
| `@rulekitai/rulekit/sqlite-warning` | Hides Node's SQLite notice, described below |

**There is no root import.** `import ... from "@rulekitai/rulekit"` throws a
message that names the subpaths instead, because every part is taken on its
own: the corpus store without the agent, or the agent without the command.

Add [`@rulekitai/ui`](https://www.npmjs.com/package/@rulekitai/ui) for React
hooks and chat components.

## The SQLite notice

The corpus store reads `node:sqlite`, which ships inside Node and is still
marked experimental. Node therefore prints this before your server starts:

```
ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

Nothing is wrong. The `rulekit` command hides that one warning by itself. A
server of your own decides for itself, in one line:

```ts
import { hideSqliteExperimentalWarning } from "@rulekitai/rulekit/sqlite-warning"

hideSqliteExperimentalWarning() // hides that one notice, prints every other warning
```

## Documentation

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one. The corpora carry their own
terms. This package ships four, and every one of them carries a CC0 1.0
dedication, so `rulekit init` hands you something you may sell what you build
on.
