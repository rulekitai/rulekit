# Run rulekit on Eve

The
[`templates/eve-agent`](https://github.com/rulekitai/rulekit/tree/main/templates/eve-agent)
directory runs the rulekit agent on [Vercel Eve](https://eve.dev). Use it when
you need durable sessions, Eve deployment, or an Eve sandbox.

Use `@rulekitai/rulekit/agent/runtime` when you need none of those features.
That runtime needs one model key and no separate agent process.

Both runtimes emit the event contract from
`@rulekitai/rulekit/agent/events`. The same rulekit interface can read either
runtime.

## Supported versions

The template uses these versions:

| Requirement | Version |
|---|---|
| Node | 24 or later |
| `eve` | `^0.57.0` |
| `ai` | `^7.0.93` |

The template package lists the supported versions. Read its `package.json`
before an upgrade. Eve also installs version-matched documentation under
`node_modules/eve/docs/`.

## Run the template

Build the corpus database before you build the agent. The database is a local
build artifact, and Git does not track it.

```bash
# From the rulekit repository root.
pnpm install
pnpm build
pnpm rulekit build data/riftbound

cd templates/eve-agent
cp .env.example .env
# Add AI_GATEWAY_API_KEY to .env.
pnpm test
pnpm eve build
pnpm exec eve info --json
pnpm dev
```

For the Riftbound corpus, `eve info` must report no diagnostic, 13 tools, and
four skills. The tools are 12 corpus tools plus `load_skill`.

## How the adapter works

Eve uses paths as identities. A file under `agent/tools/` is one tool, and its
file name is the tool name. Eve interprets a helper module in that directory as
an invalid tool, so shared adapter code stays under `lib/`.

| Path | Purpose |
|---|---|
| `agent/agent.ts` | Sets the model, reasoning level, limits, and default tools. |
| `agent/instructions.ts` | Builds the prompt from the corpus profile. |
| `agent/tools/<name>.ts` | Exposes one rulekit tool to Eve. |
| `agent/skills/<name>.ts` | Exposes one rulekit procedure to Eve. |
| `agent/channels/ask.ts` | Serves `POST /ask/stream`. |
| `lib/rules-tools.ts` | Adapts shared tools and procedures. |

The adapter follows five rules:

1. One file under `agent/tools/` exports one tool.
2. `agent/instructions.ts` supplies instructions. `defineAgent` does not take
   an `instructions` field.
3. Tool input crosses the Eve boundary as JSON Schema. The adapter converts
   the rulekit Zod schema with `z.toJSONSchema`.
4. An unavailable corpus tool returns a dynamic resolver that resolves to
   `null`. `disableTool()` removes an Eve default, not a rulekit tool.
5. `defaultTools: false` removes optional Eve tools. The template adds
   `load_skill` back because the rulekit procedures need it.

Eve persists dynamic resolver closures. Capture only serializable values in a
resolver or tool callback. The adapter captures a tool name and performs its
lookup in module state.

## The streaming route

The custom channel serves `POST /ask/stream`. It accepts the same question,
history, and retrieved-rule input that the AI SDK runtime accepts.

Eve 0.57 custom routes receive `from`. The route binds a channel address, then
sends the message through that source:

```ts
POST("/ask/stream", async (request, { from }) => {
  const session = await from(crypto.randomUUID()).send(message, { auth: null })
  // Read session.getEventStream().
})
```

One request creates one Eve session because the rulekit request already carries
its history. Do not expose this route without an ownership and access check.
The template uses `RULEKIT_INTERNAL_SECRET` and fails closed in production.

`message.appended` contains `messageDelta`. Append each delta to the current
text. `message.completed` contains the authoritative final message. Do not read
the removed `messageSoFar` field.

Usage can arrive in `step.completed` after the final message. Keep reading until
the turn or session completes, or the final step cost will be absent.

## Keep both runtimes aligned

Run the comparison after a change to the channel, events, tools, or procedures:

```bash
# Keep `pnpm dev` running in templates/eve-agent first.
pnpm compare-runtimes "what is the Shield keyword"
```

The comparison checks event names and fields. It does not compare generated
text because two correct model runs can use different words.

## Upgrade Eve

1. Update `eve` and its required `ai` peer together.
2. Read `node_modules/eve/CHANGELOG.md` and the matching installed docs.
3. Run the template test, `eve build`, and `eve info`.
4. Start the server once and send one real question through `/ask/stream`.
5. Run `compare-runtimes` to check the shared event contract.

The
[template README](https://github.com/rulekitai/rulekit/blob/main/templates/eve-agent/README.md)
explains the file layout and corpus-specific tool counts in more detail.
