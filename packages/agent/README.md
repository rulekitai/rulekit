# @rulekitai/agent

Tools, instructions, skills, and a runtime for a grounded rules assistant.

Part of [rulekit](https://github.com/rulekitai/rulekit), a rules assistant that answers from your own
rulebook, quotes it, and gives the source of each claim.

## Install

```bash
pnpm add @rulekitai/agent
```

## Use

```ts
import { createRulesAgent } from "@rulekitai/agent/runtime"

const agent = createRulesAgent({ store, profile, model: "anthropic/claude-sonnet-5" })
const answer = await agent.ask({ question: "how does a knight move" })
```

The `ai` package is a peer dependency. Install it beside this one.

## Documentation

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one.

The example corpora in the repository carry their own terms, and this package
contains none of them.
