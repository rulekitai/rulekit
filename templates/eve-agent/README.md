# The Eve template

The same agent, on [Vercel Eve](https://eve.dev) instead of the AI SDK.

Use this if you already run Eve, or if you want its durable sessions, its
sandbox, or its deployment path. If neither of those means anything to you, use
`@rulekit/agent/runtime` instead: it needs one model key and no separate process.

**Both emit the same events**, so the same interface drives either. That is what
the shared wire contract in `@rulekit/agent/events` is for, and the test in
`packages/agent` is what keeps it true.

## Run it

```bash
cp .env.example .env      # set one model credential
pnpm dev
```

## What is here

| File | What it does |
|---|---|
| `agent/agent.ts` | The model, its effort, and the session budget. |
| `agent/tools/rules.ts` | Registers every corpus tool with Eve. |
| `agent/channels/ask.ts` | `POST /eve/v1/ask/stream`, emitting the shared events. |
| `agent/tools/disabled.ts` | Switches off every built-in tool this agent must not have. |

## Why the built-in tools are switched off

An Eve agent starts with tools for reading files, running commands, and fetching
web pages. A rules assistant needs none of them, and each one is a way for a
question to reach something other than the corpus. Switching them off also stops
Eve starting a container it would otherwise need for the shell.
