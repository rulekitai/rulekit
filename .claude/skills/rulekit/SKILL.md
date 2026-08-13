---
name: rulekit
description: Add a rules assistant that answers only from a corpus you supply. Routes to one of seven rulekit skills. Use when the user names rulekit, `@rulekitai/rulekit`, or `createAskHandler`, or wants an assistant that answers only from their own rulebook.
---

# rulekit

rulekit answers a rules question from a **corpus** you supply, and cites every
claim. When the corpus holds no answer, rulekit says so.

Read this page, choose the branch, then open that skill.

## Four facts

1. **A corpus is a directory of JSON files.** It compiles to one SQLite file.
   You run no database and you call no service.
2. **The free stages answer most questions.** A rule lookup, a ban check, and a
   glossary definition read from the corpus in a few milliseconds. Only a miss
   costs a model call.
3. **Two packages sit on npm under `@rulekitai/`.** `rulekit` holds the corpus,
   the agent, the pipeline, the handler, and the command. `ui` holds the React
   parts. Neither has a root export, so import a subpath. See `rulekit-serve`.
4. **rulekit reads the corpus alone until the implementer names a site.** The
   packages hold no web access and no list of websites. An answer that reads a
   named site says so. See `rulekit-references`.

## Choose the branch

| The user wants | Open |
|---|---|
| To run it, and to answer questions from their server | `rulekit-serve` |
| A chat interface in their pages | `rulekit-interface` |
| A game other than the ones that ship | `rulekit-corpus` |
| The assistant to read a website when the corpus misses | `rulekit-references` |
| A tool or a procedure of their own | `rulekit-extend` |
| A quota, billing, or a caller's own model key | `rulekit-limits` |
| Proof that the answers invent nothing | `rulekit-verify` |

Most integrations need `rulekit-serve` and `rulekit-interface` only.

## Know which project you are in

Every command below has two forms.

| You are | Corpora live in | Run the command as |
|---|---|---|
| In a project that installed from npm | The package, reached by `rulekit init` | `npx rulekit ...` |
| In a clone of the rulekit repository | `data/`, at the root | `pnpm rulekit ...` |

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

**The Riftbound corpus stays in the repository.** Riot Games owns that data and
permits non-commercial use only, so it travels inside no package that anybody
may sell. To use it, clone the repository and copy `data/riftbound/` into the
project.

## What a finished integration changes

```
their-app/
├── api/ask          → createAskHandler({ pipeline, agent })
├── ui               → <Chat /> or useAskStream()
└── corpus.db        → built once by `rulekit build`
```

These three files, and nothing inside the installed packages.

## Completion criterion

The integration is done when all four are true:

- `npx rulekit ask <corpus> "what does rule <n> say"` prints that rule. This
  command runs the free stages only, so give it a rule number or a keyword. Add
  `--json` to read the answer from a script.
- Their own route answers a question over HTTP.
- Their interface shows the answer while it streams.
- `npx rulekit validate <corpus>` prints `Valid.`
