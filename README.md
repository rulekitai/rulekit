# rulekit

A rules assistant that answers from your own rulebook, quotes it, and gives the
source of every claim.

It reads a corpus of JSON files that you supply. Every answer comes from that
corpus. Each claim carries its rule number, its card name, or its date. When the
corpus holds no answer, the assistant says so. It does not invent one.

MIT licence. No pricing model. No required model provider. No account, except
one model key.

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

**Most questions need no key.** The assistant reads a rule lookup, a legality
check, and a keyword definition straight from the corpus. Each takes a few
milliseconds. The test suite also runs without a key.

```bash
pnpm rulekit ask data/riftbound "is Called Shot banned"
```

```
[served by static in 8 ms]

[Called Shot](card:riftbound/SFD-122.webp) is on the banned list:
- **banned** in **Constructed 2v2**, effective 2026-07-24
- **banned** in **Constructed**, effective 2026-03-30
```

## How the assistant makes an answer

A question goes through a chain of stages. The first stage that can answer wins.

| Stage | It answers | It costs |
|---|---|---|
| Exact cache | A question somebody asked before | Nothing |
| Static answers | "What does rule 300.2 say?", "Is X banned?" | Nothing |
| Glossary | "What is Shield?" | Nothing |
| **The agent** | Every other question | One model turn |

Only a question that all three stages miss goes to the agent. The agent searches
the corpus with tools, then writes an answer with sources.

Two more stages ship switched off, because each needs an account you may not
want: a semantic cache, and a pass with a cheap model.

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

`templates/eve-agent` holds the same agent on [Vercel Eve](https://eve.dev).
`examples/next-app` holds a chat that you can copy.

## Skills for an agent

`.claude/skills/` holds six skills. They tell an AI coding agent how to put
rulekit into an application. Start with the `rulekit` skill. It sends the agent
to the correct one of the other five.

## Design decisions

**The corpus is a file.** Node includes SQLite and its full-text search. You run
no database and compile no native module, so no installation step can fail. A
rule lookup reads a disk. It cannot be slow, and it cannot be down.

**This project collects no data.** It holds no importer, no scraper, and no
parser, and it fetches nothing. A corpus is an input in a documented shape, and
you decide how to make one. This keeps other people's page layouts, rate limits,
and terms out of the repository.

**There is no pricing model.** Before the server answers, it asks one question:
is this caller allowed? The shipped answer is always yes. To add quotas or
billing, write one object, the `Gate` interface. You change nothing inside these
packages.

**No model provider is required.** The model is one `"provider/model"` string,
so you change provider with one environment variable.

**You add a game with one file.** Rules that hold for every rulebook are built
in. A `profile.json` holds the rest: what the game is, what it calls things, and
how it writes its symbols. You write a profile, not a prompt.

## Add your own game

1. Write the JSON. `docs/corpus-format.md` states each field. `rulekit init
   my-game` copies a complete example to start from.
2. Run `pnpm rulekit validate my-game`. It names each problem it finds.
3. Run `pnpm rulekit build my-game`.
4. Write `my-game/profile.json`. See `docs/adding-a-game.md`.

## Check that the assistant invents nothing

The design rests on one claim: every answer comes from the corpus. `rulekit
eval` asks a list of test questions, then checks each answer for two faults. No
model judges either fault. Both are text matching against the corpus.

```bash
pnpm rulekit eval data/riftbound
```

- **The answer made up a rule number.** Each rule number in an answer must
  exist in the corpus. A wrong rule number, stated with confidence, reads
  exactly like a correct one.
- **The answer made up a quotation.** Each quoted passage must appear in the
  corpus. Invented words inside a real rule number are the same lie, with a
  source attached.

Either fault exits with a non-zero code, so a script can refuse to deploy.

The command also reports how many expected rules an answer gave. That figure is
information only, and it never fails a run: an answer can give four of seven
expected rules and still be correct.

The command needs a model key and takes about ten minutes. Run it before you
adopt a model or change the instructions, not on each push. Add `--regrade
<file>` to score a previous run again, with no model calls.

**A run that stops early counts as a failure.** A question that gives no answer
names no rule and quotes nothing, so each check on its content passes. To count
those as clean lets a failed run read as a perfect score.

**Measured with `anthropic/claude-sonnet-5` on the Riftbound corpus that
ships:** 12 of 18 questions ran before the model key reached its spending limit.
11 answers were clean. One made up rule `315.1.b.1`, which does not exist, where
`315.1.b` does. No answer made up a quotation.

The same question made up the same rule against an earlier copy of the corpus.
So it is a repeatable weakness of this model on this rulebook, and not a single
event. That is why this command exists.

## Verify the repository

```bash
pnpm check-types      # every package
pnpm test             # 266 tests, no model and no network
pnpm rulekit validate data/demo
pnpm test:e2e         # the interface, in a browser
```

## Licence

MIT, for the code. The contents of `data/` are game reference data, and the MIT
grant does not cover them. See `data/README.md`.
