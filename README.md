# rulekit

rulekit answers a rules question from your own rulebook. It quotes that
rulebook, and it gives the source of each claim. It invents nothing. When the
corpus holds no answer, it says so.

You supply a **corpus** of JSON files, and each claim carries its rule number,
its card name, or its date. rulekit holds no game of its own. It works with any
rulebook, and it needs no particular model provider.

A corpus can also hold **rulings**: a question somebody asked, the answer, and
the rules that answer rests on. One file holds card rulings, rulings about a
mechanic, and event policy. Each ruling names its publisher, and says whether it
is official.

When your corpus holds no answer, you can let the assistant read **websites that
you name**. rulekit ships no list of sites, and endorses none. An answer that
reads a site names the site, gives its address, and marks the claim as outside
your rules data.

The code carries the Apache 2.0 licence. rulekit has no price, and it needs no
account, except one model key.

## Install

```bash
pnpm add @rulekitai/rulekit
```

Use Node 22.5 or a later version.

## Ask your first question

You need no clone and no model key. The command `init` copies a corpus, and the
answer arrives in a few milliseconds.

```bash
npx rulekit init my-game
npx rulekit ask my-game "what is Swift"
```

```
[served by glossary in 1 ms]

**Swift**

> Swift is a keyword ability. A card with Swift may be played at any time a
> player holds priority, including during the opponent's turn.
```

Four corpora travel inside the package, and `--corpus` names the one you want:
`demo` (the default, an invented card game), `chess`, `texas-holdem`, and
`estate-line`. All four carry a CC0 1.0 dedication, so you may copy one and
build a product on it.

```bash
npx rulekit init my-game --corpus chess
```

The `ask` command runs the free stages only, and it never calls the agent. For a
question of another shape, it reports a miss, and it shows one question of each
shape that it does answer.

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

Add a React chat with `pnpm add @rulekitai/ui`. The
[`@rulekitai/ui` README](packages/ui/README.md) states each hook and each
component.

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

A new clone gives you a working chat in 21 seconds, and the first build of the
example application takes 17 of them.

[`CONTRIBUTING.md`](CONTRIBUTING.md) states the checks and how to send a change.

## The five corpora in this repository

The five corpora differ from each other on purpose, and **no two of them use the
same attribute name**. A chess piece has a piece value and a notation symbol. A
deed has a price and five levels of rent. One format holds all five, and the
code does not change.

| Corpus | The game | Rules | Terms | Its named pieces |
|---|---|---|---|---|
| `data/chess/` | Chess | 90 | 44 | 6 pieces and 3 items of equipment |
| `data/texas-holdem/` | Texas Hold'em poker | 93 | 59 | The 52 cards of the pack |
| `data/estate-line/` | An invented property trading game | 90 | 38 | 38 deeds and fortunes, 6 tokens |
| `data/demo/` | An invented trading card game | 27 | 6 | 12 cards |
| `data/riftbound/` | Riftbound | 3317 | 25 | 941 cards |

Four of the five travel inside the npm package, so `rulekit init my-game
--corpus chess` reaches them with no clone. Riftbound stays here, because Riot
Games owns that data, and their policy permits non-commercial use only. To use
it, clone this repository and copy `data/riftbound/` into your project.
[`data/README.md`](data/README.md) states the terms of each corpus.

## How the assistant makes an answer

A question goes through a set of stages in order. The assistant uses the first
stage that can answer.

| Stage | It answers | It costs |
|---|---|---|
| Exact cache | A question that somebody asked before | Nothing |
| Static answers | "What does rule 300.2 say?", "Is X banned?", "Rulings for X", and the question a ruling itself asks | Nothing |
| Glossary | "What is Shield?" | Nothing |
| **The agent** | Every other question | One model turn |

The agent searches the corpus with tools, then writes an answer with its
sources. [`docs/architecture.md`](docs/architecture.md) draws all four steps.

## The packages

Two packages. The split follows the only line that matters: whether you need
React and a Markdown renderer.

| Package | What it contains | Third-party dependencies |
|---|---|---|
| `@rulekitai/rulekit` | The corpus, the agent, the answer pipeline, the HTTP handler, and the `rulekit` command | `zod`, and `ai` as an optional peer |
| `@rulekitai/ui` | React hooks and styled chat components | `react-markdown`, `remark-gfm`, and `react` as a peer |

Each part keeps its own subpath, so an import states where it comes from:
`@rulekitai/rulekit/corpus/*`, `/agent/*`, `/pipeline/*`, and `/server/*`.

The code loads the `ai` package only when you use the agent. A server that
answers from the free stages alone never needs it.

The directory `templates/eve-agent` holds the same agent on
[Vercel Eve](https://eve.dev). The directory `examples/next-app` holds a chat
that you can copy.

## Where to read more

| Document | What it covers |
|---|---|
| [`docs/adding-a-game.md`](docs/adding-a-game.md) | How to write a corpus and a profile for your own game |
| [`docs/corpus-format.md`](docs/corpus-format.md) | Every field of every corpus file, including rulings |
| [`docs/custom-tools.md`](docs/custom-tools.md) | How to give the agent a tool or a procedure of your own |
| [`docs/reference-sites.md`](docs/reference-sites.md) | How to let the assistant read a website when your corpus misses |
| [`docs/architecture.md`](docs/architecture.md) | How the code makes an agent, and how one turn runs |
| [`docs/verifying-answers.md`](docs/verifying-answers.md) | How to prove that the answers invent nothing |
| [`docs/design-decisions.md`](docs/design-decisions.md) | Why one file, no data collection, and no price |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed in each release |

The directory `.claude/skills/` holds seven skills. They tell an AI coding agent
how to add rulekit to an application. Read the `rulekit` skill first. It sends
the agent to the correct one of the other six.

## Licence

**The code carries the Apache 2.0 licence.** It covers `packages/`,
`templates/`, and `examples/`.

**Each corpus carries its own terms of use.** The Apache licence does not cover
`data/`. This project wrote four of the five corpora, and dedicated them under
CC0 1.0. Riot Games owns the corpus `data/riftbound/`, and its terms permit
non-commercial use only.

To use rulekit in a commercial product, use one of the four public-domain
corpora, or supply your own. [`data/README.md`](data/README.md) states each term
in full. Both published packages carry the `NOTICE` file, as Apache 2.0 section
4(d) asks.

Riot Games' "Legal Jibber Jabber" policy permitted the creation of rulekit with
assets that Riot Games owns. Riot Games does not endorse or sponsor this
project. Riftbound and Riot Games are trademarks of Riot Games, Inc.
