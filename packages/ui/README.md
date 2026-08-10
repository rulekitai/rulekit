# @rulekitai/ui

Styled chat components for a rules assistant. Themed with CSS variables.

Part of [rulekit](https://github.com/rulekitai/rulekit), a rules assistant that answers from your own
rulebook, quotes it, and gives the source of each claim.

## Install

```bash
pnpm add @rulekitai/ui
```

## Use

```tsx
import { useAskStream } from "@rulekitai/react/use-ask-stream"
import { Chat } from "@rulekitai/ui/chat"
import { RuleKitProvider } from "@rulekitai/ui/provider"
import "@rulekitai/ui/styles.css"

function Assistant() {
  const { messages, loading, streaming, ask } = useAskStream({
    endpoint: "/api/ask",
  })

  return (
    <RuleKitProvider>
      <Chat
        messages={messages}
        loading={loading}
        streaming={streaming}
        onAsk={ask}
      />
    </RuleKitProvider>
  )
}
```

`Chat` holds no state and opens no connection. It renders what you give it, so
the hook above supplies the messages. `RuleKitProvider` must be a parent of it,
because the components read the card link scheme and the legal note from that
provider.

The components read CSS variables, so your theme controls their appearance.
React is a peer dependency.

## Documentation

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one.

The example corpora in the repository carry their own terms, and this package
contains none of them.
