# @rulekitai/react

Headless React hooks for a rules chat. No styling.

Part of [rulekit](https://github.com/rulekitai/rulekit), a rules assistant that answers from your own
rulebook, quotes it, and gives the source of each claim.

## Install

```bash
pnpm add @rulekitai/react
```

## Use

```tsx
import { useAskStream } from "@rulekitai/react/use-ask-stream"

function Assistant() {
  const { messages, loading, streaming, ask } = useAskStream({
    endpoint: "/api/ask",
  })

  return <button onClick={() => ask("how does a knight move")}>Ask</button>
}
```

`loading` is true while the request waits for its first byte. `streaming` is
true while an answer arrives. The endpoint is `/api/ask` by default.

These hooks carry no styling. Use `@rulekitai/ui` for components that do.
React is a peer dependency.

## Documentation

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one.

The example corpora in the repository carry their own terms, and this package
contains none of them.
