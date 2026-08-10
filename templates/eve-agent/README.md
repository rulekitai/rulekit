# The Eve template

This is the same agent on [Vercel Eve](https://eve.dev), in place of the AI SDK.

Use this template if you already run Eve, or if you want its durable sessions,
its sandbox, or its deployment path. If none of those apply to you, use
`@rulekit/agent/runtime` instead. That runtime needs one model key and no
separate process.

**Both runtimes send the same events**, so one interface drives either one. The
shared wire contract in `@rulekit/agent/events` makes this possible.

A command checks this. It does not assume it.

```bash
cd templates/eve-agent && pnpm dev     # needs Node 24
pnpm compare-runtimes "what is the Shield keyword"
```

The command measured both runtimes against the corpus that ships. Both sent the
same sequence of events (`step`, then `text`, then `done`), and both put the
same fields on the final event. The two answers differ in length and in wording,
because two runs of one model differ. The contract is intact. So the comparison
reads types and field names, and it never reads the text.

## Before you start

**Eve needs Node 24 or newer**, and it refuses to run on an older version. The
rest of this repository runs on Node 22. If `pnpm dev` reports this, that is the
cause.

## Run it

```bash
pnpm eve build            # checks the layout
cp .env.example .env      # set one model credential
pnpm dev
```

## What is here

| File | What it does |
|---|---|
| `agent/agent.ts` | Sets the model, its effort, and the session budget. |
| `agent/instructions.ts` | Builds the prompt from the corpus profile. |
| `agent/tools/<name>.ts` | One file for each tool. **Eve gives a tool the name of its file.** |
| `agent/skills/<name>.ts` | One file for each procedure. **Eve gives a skill the name of its file.** |
| `agent/channels/ask.ts` | Serves `POST /eve/v1/ask/stream`, and sends the shared events. |
| `lib/rules-tools.ts` | Adapts the corpus tools. It sits outside `agent/` on purpose. |

## Three rules that Eve applies to this layout

Each rule fails the build. It does not fail at run time. That is the correct
behaviour, but each message is short, and each one costs real time to
understand. So:

1. **One file in `agent/tools/` is one tool, and the file name is the tool
   name.** A file that exports more than one tool fails the build. A helper
   module in that directory also fails. This is the reason `lib/` exists.
2. **Instructions belong in `agent/instructions.ts`, and never in
   `defineAgent`.** If you pass them to `defineAgent`, the build fails with
   `Unknown key "instructions"`.
3. **A tool schema crosses the boundary as JSON Schema, and not as Zod.** Eve
   accepts either one, but a Zod object here fails with `Cannot read properties
   of undefined (reading 'input')`. Eve reads a Standard Schema field that Zod 3
   declares for the type system and does not create at run time.
   `lib/rules-tools.ts` converts the schema, so the Zod schema stays the one
   definition.

## The tools this corpus can serve, and no others

A file under `agent/tools/` exists for every tool this project can offer, and
Eve reads the directory rather than a list. So a corpus with no banned list
still has the file. The adapter switches that tool off with `disableTool()`.

Both runtimes then offer the same set. Measured: the Riftbound corpus gets 12
tools, and the chess corpus gets 9, because chess holds no errata, no banned
list, and no update notes.

## Why the procedures are skills here, and not in the prompt

Eve shows the model only a skill's `description`, and it loads the body when a
question matches. The AI SDK has no such mechanism, so that runtime puts every
procedure in front of every question.

Three procedures ship. A rules question that carries the card procedure and the
timing procedure pays for two pages it does not use. So this template keeps each
one in `agent/skills/`, and Eve loads the one that applies.

Each file holds only the wiring. The procedure itself lives once, in
`@rulekit/agent/skills`, and both runtimes read it from there.

## Why the built-in tools are off

An Eve agent starts with tools that read files, run commands, and fetch web
pages. A rules assistant needs none of them. Each one is also a route for a
question to reach something other than the corpus. Switching them off also stops
Eve from starting a container that it would otherwise need for the shell.
