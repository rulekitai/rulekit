# The Eve template

This template runs the same agent on [Vercel Eve](https://eve.dev), in place of
the AI SDK.

Use this template if you already run Eve, or if you want its durable sessions,
its sandbox, or its deployment path. If you want none of those, use
`@rulekitai/rulekit/agent/runtime` instead. That runtime needs one model key and
no separate process.

Read [`docs/eve.md`](../../docs/eve.md) for the supported versions, stream
contract, and upgrade checks.

**Both runtimes send the same events**, so one interface can drive either one.
The shared contract in `@rulekitai/rulekit/agent/events` makes this possible. A
command tests the contract, and the project does not assume it:

```bash
# from the root of the repository. Both runtimes read this database.
pnpm rulekit build data/riftbound

cd templates/eve-agent && pnpm dev     # this needs Node 24. Leave it running.
# then, from the root of the repository:
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

Build the corpus database first. It is not in version control, and every tool
here reads it. Without it the build stops with `No corpus database`:

```bash
# from the root of the repository
pnpm rulekit build data/riftbound
```

Then write one model credential into `.env` in this directory:

```bash
cp .env.example .env      # then fill in AI_GATEWAY_API_KEY
```

Then build and run:

```bash
pnpm eve build            # this checks the layout
pnpm dev
```

## The files in this template

| File | What it does |
|---|---|
| `agent/agent.ts` | Sets the model, its effort, and the session budget. |
| `agent/instructions.ts` | Builds the prompt from the corpus profile. |
| `agent/tools/<name>.ts` | One file for each tool. **Eve gives a tool the name of its file.** |
| `agent/skills/<name>.ts` | One file for each procedure. **Eve gives a skill the name of its file.** |
| `agent/channels/ask.ts` | Serves `POST /ask/stream`, and sends the shared events. |
| `lib/rules-tools.ts` | Adapts the corpus tools. It is outside `agent/` on purpose. |

## Four rules that Eve applies to this layout

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
4. **A missing corpus tool needs a dynamic resolver.** `disableTool()` removes
   an Eve default. It cannot remove one of this project's tools. To say a corpus
   cannot offer one of its own tools, return a resolver that answers with
   nothing:

   ```ts
   defineDynamic({ events: { "session.started": () => null } })
   ```

## This corpus serves its own tools, and no others

A file in `agent/tools/` exists for every tool that this project can offer, and
Eve reads the directory in place of a list. A corpus with no banned list
therefore still has the file. The adapter switches that tool off with
the empty dynamic resolver above.

Both runtimes then offer the same set of tools. Measured: the Riftbound corpus
gets 12 tools, and the chess corpus gets 10. Chess has no errata, no banned
list, and no update notes, so it loses three tools. Chess holds six rulings, so
it keeps `list_rulings`. Riftbound holds none, so it loses that one instead.

## Why the procedures are skills here, and not part of the prompt

Eve shows the model only the `description` of a skill. It loads the body when a
question matches that description. The AI SDK has no such mechanism, so that
runtime puts every procedure in front of every question.

This project ships four procedures: the card procedure, the rulings procedure,
the interaction procedure, and the timing procedure. A rules question that
carries all four pays for three pages that it does not use. This template
therefore keeps each procedure in `agent/skills/`, and Eve loads the one that
applies.

Each file in that directory holds only the connection. The procedure itself
exists one time, in `@rulekitai/rulekit/agent/skills`, and both runtimes read it
from there.

A procedure whose tools this corpus does not offer shrinks to one sentence. Eve
reads the whole directory and cannot drop a file, so `eveSkill` in
`lib/rules-tools.ts` does the same job that the AI SDK runtime does by leaving
the procedure out. Without that, a corpus with no ruling would still receive a
procedure that names `list_rulings`, and the model would call a tool that is
not there.

## Why the built-in tools are off

`defaultTools: false` disables Eve's optional shell, file, network, planning,
question, and delegation tools. The template adds `load_skill` back because its
four procedures need it. The model can otherwise call only corpus tools.
