# rulekit

A rules assistant that answers from your own rulebook, quotes it, and cites it.

It reads a corpus of JSON you supply. Every answer comes from that corpus, and
every claim carries the rule number, card name, or date it came from. When the
corpus does not hold an answer, it says so instead of inventing one.

MIT licensed. No pricing model, no required provider, no account beyond one
model key.

## Run it

```bash
git clone <this repository> && cd rulekit
pnpm install
pnpm rulekit build data/riftbound

cd examples/next-app
cp .env.example .env          # set one model key
pnpm dev                      # http://localhost:3210
```

**Many questions need no key at all.** Rule lookups, ban checks, and glossary
definitions are read straight from the corpus in a few milliseconds. Try
`rulekit ask` before you set anything up:

```bash
pnpm rulekit ask data/riftbound "is Called Shot banned"
```

```
[served by static in 8 ms]

[Called Shot](card:riftbound/SFD-122.webp) is on the banned list:
- **banned** in **Constructed 2v2**, effective 2026-07-24
- **banned** in **Constructed**, effective 2026-03-30

Effective 2026-07-24.
```

## How an answer is produced

A question walks a chain of stages, and the first one that can answer wins.

| Stage | Answers | Costs |
|---|---|---|
| Exact cache | A question already asked | Nothing |
| Static answers | "What does rule 300.2 say?", "Is X banned?" | Nothing |
| Glossary | "What is Shield?" | Nothing |
| **The agent** | Everything else | One model turn |

The first three need no model and no account. Only a genuine miss reaches the
agent, which searches the corpus with tools and writes a cited answer.

Two more stages ship switched off, because each one needs an account you may not
want: a semantic cache and a cheap-model pass. Add them when the traffic
justifies the setup.

## What is in the box

| Package | What it is |
|---|---|
| `@rulekit/corpus` | The JSON schema, a SQLite builder, and one read interface |
| `@rulekit/agent` | Tools, instructions, procedures, and an AI SDK runtime |
| `@rulekit/pipeline` | The stages, the cache, the gate, and credentials |
| `@rulekit/server` | One web-standard HTTP handler |
| `@rulekit/react` | Headless hooks. No styling |
| `@rulekit/ui` | Styled chat components, themed with CSS variables |
| `@rulekit/cli` | `rulekit validate`, `build`, `init`, `ask` |

Plus `templates/eve-agent`, the same agent on [Vercel Eve](https://eve.dev), and
`examples/next-app`, a chat you can fork.

## Design decisions worth knowing

**The corpus is a file.** SQLite ships inside Node, and so does its full-text
search, so there is no database to run, no native module to compile, and no
install step that can fail. A rules lookup is a disk read: it cannot be slow and
it cannot be down.

**This project collects no data.** There is no importer, no scraper, and no
parser. A corpus is an input in a documented shape, and how you produce one is
yours to decide. That keeps this repository small and free of anybody else's
page layout, rate limit, or terms.

**There is no pricing model.** The shipped gate allows everything and records
nothing. A fork adds quotas or billing by implementing `Gate`, and never edits
anything inside these packages to do it.

**No provider is required.** The model is a `"provider/model"` string, so
changing provider is one environment variable. Read a key from the environment,
from a request header for bring-your-own-key, or from an OAuth sign-in you
configure yourself.

**Adding a game is one file.** The instructions split into rules that hold for
every rulebook and a `profile.json` that holds the rest: what the game is, what
it calls things, how its symbols are written. You write a profile, not a prompt.

## Add your own game

1. Write the JSON. `docs/corpus-format.md` states the shape field by field.
   `rulekit init my-game` copies a complete worked example to start from.
2. `pnpm rulekit validate my-game` — it names every problem it finds.
3. `pnpm rulekit build my-game`
4. Write `my-game/profile.json`. See `docs/adding-a-game.md`.

## Check that it does not lie

The design rests on one claim: every answer comes from the corpus. `rulekit eval`
is what checks it, and it applies two gates that no model judges.

```bash
pnpm rulekit eval data/riftbound
```

- **Fabricated citation.** Every rule number in an answer must exist in the
  corpus. A confidently cited wrong rule reads exactly like a correct one.
- **Fabricated quotation.** Every quoted passage must be corpus text. A real
  rule number wrapped around invented words is the same lie wearing a citation.

Either failure exits non-zero. Citation recall is reported and is never a gate:
an answer can cite four of seven expected rules and be completely right.

It needs a model credential and takes about ten minutes, so it is a command you
run before adopting a model or changing the instructions, not one for every push.
Add `--regrade <file>` to grade a previous run's saved answers again, with no
model calls at all.

**Measured, 18 questions, `anthropic/claude-sonnet-5`, the shipped Riftbound
corpus:** 17 of 18 clean. One fabricated citation — rule `315.1.b.1`, which does
not exist, where `315.1.b` does. Zero fabricated quotations. Citation recall 38%.

That one fabrication is why the gate exists, and why it exits non-zero.

## Verify it

```bash
pnpm check-types      # every package
pnpm test             # 255 tests, no model and no network
pnpm rulekit validate data/demo
pnpm test:e2e         # the interface, in a browser
```

## Licence

MIT, for the code. The contents of `data/` are game reference data and are
outside that grant — see `data/README.md`.
