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
git clone https://github.com/rulekitai/rulekit.git
cd rulekit
pnpm install
```

Use Node 22 or a later version. This repository includes an `.nvmrc` file.

## Ask your first question

This command needs no model key. It answers in a few milliseconds.

```bash
pnpm rulekit ask data/riftbound "is Called Shot banned"
```

```
[served by static in 4 ms]

[Called Shot](card:riftbound/SFD-122.webp) is on the banned list:
- **banned** in **Constructed 2v2**, effective 2026-07-24 — source: Ban List Update — July 24, 2026
- **banned** in **Constructed**, effective 2026-03-30 — source: Constructed Banlist Update — March 30, 2026

Effective 2026-07-24.
```

Two more questions that need no key:

```bash
pnpm rulekit ask data/chess "what does rule 200.6 say"
pnpm rulekit ask data/chess "what is castling"
```

The `ask` command runs the free stages only. It does not call the agent. For a
question of a different type, it tells you that it cannot answer. It then shows
you a question of each type that it does answer. To reach the agent, start the
chat application.

## Start the chat application

```bash
pnpm rulekit build data/riftbound   # 65 ms for 3317 rules and 941 cards
cd examples/next-app
cp .env.example .env                # write one model key in this file
pnpm dev                            # http://localhost:3210
```

A new clone gives you a working chat in 21 seconds. The first build of the
example application takes 17 of those seconds.

To check the repository, run `pnpm lint && pnpm check-types && pnpm test`. The
tests use no model and no network.

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

| Package | What it contains |
|---|---|
| `@rulekitai/rulekit` | The corpus, the agent, the answer pipeline, the HTTP handler, and the `rulekit` command |
| `@rulekitai/ui` | React hooks and styled chat components |

```bash
pnpm add @rulekitai/rulekit        # a server, or the command line
pnpm add @rulekitai/ui react       # a React interface, as well
pnpm add ai                        # only if you use the agent
```

Each part keeps its own subpath, so an import states where it comes from:

```ts
import { SqliteStore } from "@rulekitai/rulekit/corpus/sqlite-store"
import { createRulesAgent } from "@rulekitai/rulekit/agent/runtime"
import { createPipeline } from "@rulekitai/rulekit/pipeline/pipeline"
import { createAskHandler } from "@rulekitai/rulekit/server/handler"
import { useAskStream } from "@rulekitai/ui/use-ask-stream"
```

The `ai` package is a peer dependency, and the code loads it only when you use
the agent. `react` is a peer dependency of `@rulekitai/ui`.

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
