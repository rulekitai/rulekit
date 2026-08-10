# The Eve template

This template runs the same agent on [Vercel Eve](https://eve.dev), in place of
the AI SDK.

Use this template if you already run Eve, or if you want its durable sessions,
its sandbox, or its deployment path. If you want none of those, use
`@rulekitai/rulekit/agent/runtime` instead. That runtime needs one model key and no
separate process.

**Both runtimes send the same events**, so one interface can drive either one.
The shared contract in `@rulekitai/rulekit/agent/events` makes this possible.

A command tests this contract. The project does not assume it.

```bash
cd templates/eve-agent && pnpm dev     # this needs Node 24
pnpm compare-runtimes "what is the Shield keyword"
```

The command measured both runtimes against the corpus in this repository. Both
runtimes sent the same sequence of events (`step`, then `text`, then `done`),
and both put the same fields on the final event. The two answers have a
different length and different words, because two runs of one model give
different text. The contract is correct. The comparison therefore reads types
and field names, and it never reads the text.

## Before you start

**Eve needs Node 24 or a later version**, and it stops on an earlier version.
The rest of this repository runs on Node 22. If `pnpm dev` reports this problem,
the Node version is the cause.

## Run it

```bash
pnpm eve build            # this checks the layout
cp .env.example .env      # write one model credential in this file
pnpm dev
```

## The files in this template

| File | What it does |
|---|---|
| `agent/agent.ts` | Sets the model, its effort, and the session budget. |
| `agent/instructions.ts` | Builds the prompt from the corpus profile. |
| `agent/tools/<name>.ts` | One file for each tool. **Eve gives a tool the name of its file.** |
| `agent/skills/<name>.ts` | One file for each procedure. **Eve gives a skill the name of its file.** |
| `agent/channels/ask.ts` | Serves `POST /eve/v1/ask/stream`, and sends the shared events. |
| `lib/rules-tools.ts` | Adapts the corpus tools. It is outside `agent/` on purpose. |

## Three rules that Eve applies to this layout

Each rule stops the build. None of them stops the program at run time. That
behaviour is correct, but each message is short, and each one costs real time to
understand. Therefore:

1. **One file in `agent/tools/` is one tool, and the file name is the tool
   name.** A file that exports more than one tool stops the build. A helper
   module in that directory also stops the build. This is the reason for the
   `lib/` directory.
2. **Put the instructions in `agent/instructions.ts`, and not in
   `defineAgent`.** If you give them to `defineAgent`, the build stops with the
   message `Unknown key "instructions"`.
3. **A tool schema crosses the boundary as JSON Schema, and not as Zod.** Eve
   accepts either format, but a Zod object here stops the build with the message
   `Cannot read properties of undefined (reading 'input')`. Eve reads a Standard
   Schema field. Zod 3 declares that field for the type system, and it does not
   create the field at run time. The file `lib/rules-tools.ts` converts the
   schema, so the Zod schema stays the one definition.

## This corpus serves its own tools, and no others

A file in `agent/tools/` exists for every tool that this project can offer, and
Eve reads the directory in place of a list. A corpus with no banned list
therefore still has the file. The adapter switches that tool off with
`disableTool()`.

Both runtimes then offer the same set of tools. Measured: the Riftbound corpus
gets 12 tools, and the chess corpus gets 9 tools. Chess has no errata, no banned
list, and no update notes.

## Why the procedures are skills here, and not part of the prompt

Eve shows the model only the `description` of a skill. It loads the body when a
question matches that description. The AI SDK has no such mechanism, so that
runtime puts every procedure in front of every question.

This project ships three procedures. A rules question that carries the card
procedure and the timing procedure pays for two pages that it does not use. This
template therefore keeps each procedure in `agent/skills/`, and Eve loads the
one that applies.

Each file in that directory holds only the connection. The procedure itself
exists one time, in `@rulekitai/rulekit/agent/skills`, and both runtimes read it from
there.

## Why the built-in tools are off

An Eve agent starts with tools that read files, run commands, and fetch web
pages. A rules assistant needs none of them. Each one is also a path for a
question to reach something other than the corpus. These tools are off, and that
also stops Eve from starting a container for the shell.
