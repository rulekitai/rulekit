# @rulekitai/ui

React hooks and styled chat components for a grounded rules assistant.

Part of [rulekit](https://github.com/rulekitai/rulekit).

## Install

```bash
pnpm add @rulekitai/ui @rulekitai/rulekit
```

`react` is a peer dependency.

## Use

```tsx
import { useAskStream } from "@rulekitai/ui/use-ask-stream"
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
the hook above supplies the messages. `RuleKitProvider` must be a parent,
because the components read the card link scheme and the legal note from it.

The hooks carry no styling, so you can use them without the components. The
components read CSS variables, so your theme controls their appearance.

## Documentation

- [The three interface levels](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one.
