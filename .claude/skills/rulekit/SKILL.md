---
name: rulekit
description: Add a grounded rules assistant to an app, using the rulekit packages. Routes to the skill for the task at hand. Use when the user wants to add a rules chat, a rules lookup, a judge assistant, or a card-and-rules question box to their site; mentions rulekit, `@rulekitai/rulekit`, `createAskHandler`, or a corpus of rules; or asks how to make an assistant answer only from their own rulebook.
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
3. **The packages are on npm under `@rulekitai/`.** Install the ones the task
   needs. See `rulekit-serve`.

## Pick the branch

| The user wants | Open |
|---|---|
| To run it, and to answer questions from their server | `rulekit-serve` |
| A chat interface in their pages | `rulekit-interface` |
| To use a game other than the one that ships | `rulekit-corpus` |
| Quotas, billing, or a caller's own model key | `rulekit-limits` |
| Proof that the answers invent nothing | `rulekit-verify` |

Most integrations need `rulekit-serve` and `rulekit-interface` only.

## Know where you are standing

Every command below has two forms, and which one works depends on where the
user's project sits. Decide this before you plan anything.

| You are | Corpora live in | Run the command as |
|---|---|---|
| In a project that installed from npm | The package, reached by `rulekit init` | `npx rulekit ...` |
| In a clone of the rulekit repository | `data/`, at the root | `pnpm rulekit ...` |

Then check the ground:

```bash
node --version              # 22.5 or newer
npx rulekit --version       # the package is installed, and which version
ls data/                    # ONLY in a clone of the repository
```

**Four corpora travel inside the package**: `demo` (an invented card game),
`chess`, `texas-holdem`, and `estate-line`. Copy one and skip `rulekit-corpus`:

```bash
npx rulekit init my-game --corpus chess
```

All four carry a CC0 1.0 dedication, so a commercial product may use them.

**The Riftbound corpus is in the repository only.** Riot Games owns that data
and permits non-commercial use only, so it does not travel inside a package
that anybody may sell. To use it, clone the repository and copy
`data/riftbound/` into the project.

## The shape of a finished integration

```
their-app/
├── api/ask          → createAskHandler({ pipeline, agent })
├── ui               → <Chat /> or useAskStream()
└── corpus.db        → built once by `rulekit build`
```

Three files change in their app. Nothing inside the installed packages changes.

## Completion criterion

The integration is done when all four are true:

- `npx rulekit ask <corpus> "what does rule <n> say"` prints that rule. This
  command runs the free stages only, so ask it a rule number or a keyword. Add
  `--json` to read the answer from a script.
- Their own route answers a question over HTTP.
- Their interface shows the answer as it streams.
- `npx rulekit validate <corpus>` prints `Valid.`
