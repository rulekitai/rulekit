# rulekit

rulekit is a rules assistant. It answers questions from your own rulebook, it
quotes that rulebook, and it gives the source of each claim.

You supply a corpus of JSON files. Every answer comes from that corpus. Each
claim gives its rule number, its card name, or its date. When the corpus has no
answer, the assistant tells you. It does not invent an answer.

This project contains no game. It works with any rulebook, and it needs no
particular model provider. The code uses the Apache 2.0 licence. There is no
price and no account, except one model key.

## Install

```bash
pnpm add @rulekitai/rulekit
```

Use Node 22 or a later version.

## Ask your first question

No clone, and no model key. `init` gives you a corpus to start from, and the
answer arrives in a few milliseconds.

```bash
npx rulekit init my-game
npx rulekit ask my-game "what is Swift"
```

Four corpora travel inside the package, and `--corpus` names the one you want:
`demo` (the default, an invented card game), `chess`, `texas-holdem`, and
`estate-line`. All four carry a CC0 1.0 dedication, so you may copy one and
build a product on it.

```bash
npx rulekit init my-game --corpus chess
```

```
[served by glossary in 1 ms]

**Swift**

> Swift is a keyword ability. A card with Swift may be played at any time a
> player holds priority, including during the opponent's turn.
```

The `ask` command runs the free stages only. It does not call the agent. For a
question of a different type, it tells you that it cannot answer, and it shows
you a question of each type that it does answer.

## Put it in your application

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

Run `npx rulekit build my-game` first, because a server reads the compiled
database. `createAskHandler` returns a plain function from `Request` to
`Response`, so the same export works in Next.js, Hono, Bun, Deno, and a
Cloudflare Worker.

Add the interface with `pnpm add @rulekitai/ui react`:

```tsx
import { useAskStream } from "@rulekitai/ui/use-ask-stream"
import { Chat } from "@rulekitai/ui/chat"
import { RuleKitProvider } from "@rulekitai/ui/provider"
import "@rulekitai/ui/styles.css"

const { messages, loading, streaming, ask } = useAskStream({ endpoint: "/api/ask" })
```

[`docs/adding-a-game.md`](docs/adding-a-game.md) covers a corpus of your own,
from the first JSON file to the finished profile.

## Run this repository

Clone it to read the five example corpora, to try the chat application, or to
send a change.

```bash
git clone https://github.com/rulekitai/rulekit.git
cd rulekit
pnpm install
pnpm build                          # the example application reads the output

pnpm rulekit ask data/riftbound "is Called Shot banned"   # no model key

pnpm rulekit build data/riftbound   # 65 ms for 3317 rules and 941 cards
cd examples/next-app
cp .env.example .env                # write one model key in this file
pnpm dev                            # http://localhost:3210
```

A new clone gives you a working chat in 21 seconds. The first build of the
example application takes 17 of those seconds.

To check the repository, run `pnpm lint && pnpm check-types && pnpm test`. The
tests use no model and no network.
[`CONTRIBUTING.md`](CONTRIBUTING.md) states the rest.

## The five corpora in this repository

The five corpora are different from each other on purpose, and **no two of them
use the same attribute name**. A chess piece has a piece value and a notation
symbol. A poker card has a rank and a suit. A deed has a price and five levels
of rent. The format is the same for all five, and the code does not change.

| Corpus | The game | Rules | Terms | Its named pieces |
|---|---|---|---|---|
| `data/chess/` | Chess | 90 | 44 | 6 pieces and 3 items of equipment |
| `data/texas-holdem/` | Texas Hold'em poker | 93 | 59 | The 52 cards of the pack |
| `data/estate-line/` | An invented property trading game | 90 | 38 | 38 deeds and fortunes, 6 tokens |
| `data/demo/` | An invented trading card game | 27 | 6 | 12 cards |
| `data/riftbound/` | Riftbound | 3317 | 25 | 941 cards |

**Four of the five travel inside the npm package**, so `rulekit init my-game
--corpus chess` reaches them with no clone. Riftbound stays here: Riot Games
owns that data, and their policy permits non-commercial use only. To use it,
clone this repository and copy `data/riftbound/` into your project. Read
[`data/README.md`](data/README.md) for the terms of each one.

## How the assistant makes an answer

A question goes through a set of stages in order. The assistant uses the first
stage that can answer.

| Stage | It answers | It costs |
|---|---|---|
| Exact cache | A question that somebody asked before | Nothing |
| Static answers | "What does rule 300.2 say?", "Is X banned?" | Nothing |
| Glossary | "What is Shield?" | Nothing |
| **The agent** | Every other question | One model turn |

If the three free stages give no answer, the agent answers the question. The
agent searches the corpus with tools, then it writes an answer with its sources.
[`docs/architecture.md`](docs/architecture.md) shows all four steps as diagrams.

## The packages

Two packages. The split follows the only line that matters: whether you need
React and a Markdown renderer.

| Package | What it contains | Third-party dependencies |
|---|---|---|
| `@rulekitai/rulekit` | The corpus, the agent, the answer pipeline, the HTTP handler, and the `rulekit` command | `zod`, and `ai` as an optional peer |
| `@rulekitai/ui` | React hooks and styled chat components | `react-markdown`, `remark-gfm`, and `react` as a peer |

Each part keeps its own subpath, so an import states where it comes from:
`@rulekitai/rulekit/corpus/*`, `/agent/*`, `/pipeline/*`, and `/server/*`.

The code loads the `ai` package only when you use the agent, so a server that
answers from the free stages alone never needs it.

The directory `templates/eve-agent` contains the same agent on
[Vercel Eve](https://eve.dev). The directory `examples/next-app` contains a chat
that you can copy.

## Where to read more

| Document | What it covers |
|---|---|
| [`docs/adding-a-game.md`](docs/adding-a-game.md) | How to write a corpus and a profile for your own game |
| [`docs/corpus-format.md`](docs/corpus-format.md) | Each field of the eight JSON files |
| [`docs/architecture.md`](docs/architecture.md) | How the code makes an agent, and how one turn runs |
| [`docs/verifying-answers.md`](docs/verifying-answers.md) | How to prove that the answers invent nothing |
| [`docs/design-decisions.md`](docs/design-decisions.md) | Why one file, no data collection, and no price |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each release |

The directory `.claude/skills/` contains six skills. They tell an AI coding
agent how to add rulekit to an application. Read the `rulekit` skill first. It
sends the agent to the correct one of the other five.

## Licence

**The code uses the Apache 2.0 licence.** This covers `packages/`, `templates/`,
and `examples/`.

**Each corpus has its own terms of use.** The Apache licence does not cover
`data/`. Four of the five corpora use the CC0 1.0 licence, and this project
wrote them. The corpus `data/riftbound/` is the property of Riot Games, and its
terms permit non-commercial use only.

To use rulekit in a commercial product, use one of the four public-domain
corpora, or supply your own. [`data/README.md`](data/README.md) states each term
in full, and the `NOTICE` file is included with every copy of the code.

Riot Games' "Legal Jibber Jabber" policy permitted the creation of rulekit with
assets that Riot Games owns. Riot Games does not endorse or sponsor this
project. Riftbound and Riot Games are trademarks of Riot Games, Inc.
