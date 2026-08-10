# rulekit

A rules assistant that answers from your own rulebook, quotes it, and gives the
source of every claim.

It reads a corpus of JSON files that you supply. Every answer comes from that
corpus. Each claim carries its rule number, its card name, or its date. When the
corpus holds no answer, the assistant says so. It does not invent one.

No game is built in, and no model provider is required. Apache 2.0 licence, no
pricing model, and no account except one model key.

## Run it

```bash
git clone <this repository> && cd rulekit
pnpm install                       # 2 seconds
pnpm rulekit build data/riftbound  # 65 ms, 3317 rules and 941 cards

cd examples/next-app
cp .env.example .env               # set one model key
pnpm dev                           # http://localhost:3210
```

A clean clone reaches a working chat in **21 seconds**. The example app's first
build takes 17 of them. Use Node 22 or newer. An `.nvmrc` file is here.

To check the repository: `pnpm lint && pnpm check-types && pnpm test` runs 284
tests with no model and no network.

## Try it with no model key

Most questions need no key. A rule lookup, a legality question, and a keyword
definition are read straight from the corpus in a few milliseconds.

```bash
pnpm rulekit ask data/riftbound "is Called Shot banned"
pnpm rulekit ask data/chess "what does rule 200.6 say"
pnpm rulekit ask data/chess "what is castling"
```

`rulekit ask` runs those free stages only, and never calls the agent. It reports
a miss for a question of any other shape. Start the example app above to reach
the agent.

## The five corpora that ship

They are deliberately unalike, and **no two share a single attribute name**.
Chess pieces carry a piece value and a notation symbol, poker cards carry a rank
and a suit, and a deed carries a price and five levels of rent. Same format,
same code, no change between them.

| Corpus | The game | Rules | Terms | Its named pieces |
|---|---|---|---|---|
| `data/chess/` | Chess | 90 | 44 | 6 pieces and 3 items of equipment |
| `data/texas-holdem/` | Texas Hold'em poker | 93 | 59 | The 52 cards of the pack |
| `data/estate-line/` | An invented property trading game | 90 | 38 | 38 deeds and fortunes, 6 tokens |
| `data/demo/` | An invented trading card game | 27 | 6 | 12 cards |
| `data/riftbound/` | Riftbound | 3317 | 25 | 941 cards |

## How an answer is made

A question goes through a chain of stages. The first stage that can answer wins.

| Stage | It answers | It costs |
|---|---|---|
| Exact cache | A question somebody asked before | Nothing |
| Static answers | "What does rule 300.2 say?", "Is X banned?" | Nothing |
| Glossary | "What is Shield?" | Nothing |
| **The agent** | Every other question | One model turn |

Only a question that all three stages miss goes to the agent. The agent searches
the corpus with tools, then writes an answer with sources.
[`docs/architecture.md`](docs/architecture.md) draws all four steps.

## The packages

| Package | What it holds |
|---|---|
| `@rulekit/corpus` | The JSON schema, a SQLite builder, and one read interface |
| `@rulekit/agent` | Tools, instructions, procedures, and an AI SDK runtime |
| `@rulekit/pipeline` | The stages, the cache, the permission check, and credentials |
| `@rulekit/server` | One HTTP handler that uses web standards |
| `@rulekit/react` | Hooks with no styling |
| `@rulekit/ui` | Chat components, themed with CSS variables |
| `@rulekit/cli` | `rulekit validate`, `build`, `init`, `ask`, and `eval` |

Nothing is published to npm. Fork this repository, or copy `packages/` into
another one. `templates/eve-agent` holds the same agent on
[Vercel Eve](https://eve.dev), and `examples/next-app` holds a chat you can copy.

## Where to go next

| Document | It covers |
|---|---|
| [`docs/adding-a-game.md`](docs/adding-a-game.md) | Write a corpus and a profile for your own game |
| [`docs/corpus-format.md`](docs/corpus-format.md) | Every field of the eight JSON files |
| [`docs/architecture.md`](docs/architecture.md) | How a corpus becomes an agent, and how a turn runs |
| [`docs/verifying-answers.md`](docs/verifying-answers.md) | Prove that the answers invent nothing |
| [`docs/design-decisions.md`](docs/design-decisions.md) | Why a file, no data collection, and no pricing model |

`.claude/skills/` holds six skills that tell an AI coding agent how to put
rulekit into an application. Start with the `rulekit` skill. It sends the agent
to the correct one of the other five.

## Licence

**Apache 2.0 for the code**: everything in `packages/`, `templates/`, and
`examples/`. **Game data carries its own terms**, and the Apache licence does not
cover `data/`. Four of the five corpora are CC0 1.0 public domain and were
written for this project. `data/riftbound/` is Riot Games' property and permits
non-commercial use only.

To use rulekit in a commercial product, use one of the four public-domain
corpora, or supply your own. [`data/README.md`](data/README.md) states every
term in full, and `NOTICE` travels with every copy of the code.

rulekit was created under Riot Games' "Legal Jibber Jabber" policy using assets
owned by Riot Games. Riot Games does not endorse or sponsor this project.
Riftbound and Riot Games are trademarks of Riot Games, Inc.
