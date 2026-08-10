---
name: rulekit
description: Add a grounded rules assistant to an app, using the rulekit packages. Routes to the skill for the task at hand. Use when the user wants to add a rules chat, a rules lookup, a judge assistant, or a card-and-rules question box to their site; mentions rulekit, `@rulekit/server`, `createAskHandler`, or a corpus of rules; or asks how to make an assistant answer only from their own rulebook.
---

# rulekit

rulekit answers rules questions from a **corpus** you supply, and cites every
claim. It invents nothing: when the corpus has no answer, it says so.

Read this page, pick the branch, then open that skill.

## First, know these three facts

1. **A corpus is a directory of JSON files.** It compiles to one SQLite file.
   There is no database to run and no service to call.
2. **Most questions never reach a model.** Rule lookups, ban checks, and
   glossary definitions read straight from the corpus in a few milliseconds.
   Only a genuine miss costs a model call.
3. **Nothing is published to npm.** Fork the repository, or copy `packages/`
   into your own. See `rulekit-serve`.

## Pick the branch

| The user wants | Open |
|---|---|
| To run it, and to answer questions from their server | `rulekit-serve` |
| A chat interface in their pages | `rulekit-interface` |
| To use a game other than the one that ships | `rulekit-corpus` |
| Quotas, billing, or a caller's own model key | `rulekit-limits` |
| Proof that the answers invent nothing | `rulekit-verify` |

Most integrations need `rulekit-serve` and `rulekit-interface` only.

## Check the ground first

Run these before you plan anything. They tell you which branch applies.

```bash
ls data/                  # which games ship
cat data/*/profile.json   # whether a profile already exists
node --version            # 22.5 or newer
```

**Five corpora already ship**, so most apps need no corpus work: `riftbound`,
`chess`, `texas-holdem`, `estate-line`, and `demo`. Point at one and skip
`rulekit-corpus`.

**Four of the five are public domain.** `riftbound` is Riot Games' property and
permits non-commercial use only, so a commercial app must use one of the others
or supply its own corpus.

## The shape of a finished integration

```
their-app/
├── api/ask          → createAskHandler({ pipeline, agent })
├── ui               → <Chat /> or useAskStream()
└── corpus.db        → built once by `rulekit build`
```

Three files change in their app. Nothing inside `packages/` changes.

## Completion criterion

The integration is done when all four are true:

- `pnpm rulekit ask <corpus> "<a rule question>"` prints an answer.
- Their own route answers a question over HTTP.
- Their interface shows the answer as it streams.
- `pnpm rulekit validate <corpus>` prints `Valid.`
