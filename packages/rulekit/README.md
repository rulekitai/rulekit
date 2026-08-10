# @rulekitai/rulekit

A grounded rules assistant: the corpus, the agent, the answer pipeline, the HTTP
handler, and the `rulekit` command.

It answers questions from your own rulebook, it quotes that rulebook, and it
gives the source of each claim. When the corpus has no answer, it says so.

Part of [rulekit](https://github.com/rulekitai/rulekit).

## Install

```bash
pnpm add @rulekitai/rulekit
pnpm add ai                  # only if you use the agent
```

## Use

```bash
npx rulekit init my-game       # copy the example corpus
npx rulekit validate my-game   # names every problem
npx rulekit build my-game      # writes my-game/corpus.db
```

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

Add [`@rulekitai/ui`](https://www.npmjs.com/package/@rulekitai/ui) for React
hooks and chat components.

## Documentation

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one. The example corpora carry
their own terms, and this package ships only the public-domain demo corpus that
`rulekit init` copies.
