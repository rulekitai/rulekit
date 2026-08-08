# The Eve template

The same agent, on [Vercel Eve](https://eve.dev) instead of the AI SDK.

Use this if you already run Eve, or if you want its durable sessions, its
sandbox, or its deployment path. If neither of those means anything to you, use
`@rulekit/agent/runtime` instead: it needs one model key and no separate process.

**Both emit the same events**, so the same interface drives either. That is what
the shared wire contract in `@rulekit/agent/events` is for, and the test in
`packages/agent` is what keeps it true.

## Before you start

**Eve needs Node 24 or newer**, and refuses to run on anything older. The rest of
this repository runs on Node 22. If `pnpm dev` here says so, that is why.

## Run it

```bash
pnpm eve build            # verifies the layout
cp .env.example .env      # set one model credential
pnpm dev
```

## What is here

| File | What it does |
|---|---|
| `agent/agent.ts` | The model, its effort, and the session budget. |
| `agent/instructions.ts` | Builds the prompt from the corpus profile. |
| `agent/tools/<name>.ts` | One file per tool. **Eve names a tool after its file.** |
| `agent/channels/ask.ts` | `POST /eve/v1/ask/stream`, emitting the shared events. |
| `lib/rules-tools.ts` | Adapts the corpus tools. Outside `agent/` on purpose. |

## Three rules Eve enforces on this layout

Each one fails the build rather than failing at run time, which is the right
trade, but the messages are terse. They cost real time to work out, so:

1. **A file under `agent/tools/` is one tool, and its filename is the tool's
   name.** A file exporting several tools fails. A helper module there fails.
   That is why `lib/` exists.
2. **Instructions live in `agent/instructions.ts`, never in `defineAgent`.**
   Passing them to `defineAgent` fails with `Unknown key "instructions"`.
3. **Tool schemas cross the boundary as JSON Schema, not as Zod.** Eve accepts
   either, but a Zod object here fails with
   `Cannot read properties of undefined (reading 'input')`: Eve reads a Standard
   Schema field that Zod 3 declares for the type system and does not create at
   run time. `lib/rules-tools.ts` converts, so the Zod schema stays the single
   definition.

## Why the built-in tools are switched off

An Eve agent starts with tools for reading files, running commands, and fetching
web pages. A rules assistant needs none of them, and each one is a way for a
question to reach something other than the corpus. Switching them off also stops
Eve starting a container it would otherwise need for the shell.
