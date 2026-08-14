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

**Every component and every hook has its own subpath, as above.** An application
that wants the hooks alone never loads the styled components, so there is no
root import: `import ... from "@rulekitai/ui"` throws a message that names the
subpaths instead.

The hooks carry no styling, so you can use them without the components. The
components read CSS variables, so your theme controls their appearance.

## Say something true under each answer

`disclaimer` takes a node, or a function. Take the function. It receives three
facts, and each one changes what is true of the answer above it.

```tsx
import { answerSource, type ReadSource } from "@rulekitai/ui/message"

<RuleKitProvider
  disclaimer={(servedBy: string, sources: ReadSource[], source?: string) => {
    const base =
      answerSource(servedBy, source) === "model"
        ? "Written by an AI from the rules data."
        : "Read from the rules data, with no AI."
    return sources.length
      ? `${base} It also read ${sources.map((s) => s.name).join(", ")}, outside the rules data.`
      : base
  }}
/>
```

**`servedBy` is the stage that served the answer.** Most answers come from the
free stages, where no model runs. One fixed sentence about an AI therefore
states the opposite of what happened, and it contradicts the trace line above
it.

**`source` is where the facts came from, which is NOT the stage that served
them.** PASS BOTH TO `answerSource`, as above. A cache hit serves an answer a
model wrote earlier, and `servedBy` then reads `"cache"`. Reading the stage
alone labels a model's own words "no AI wrote this", on every repeated question,
which is every question a cache exists for. `answerSource` reads the origin
first and falls back to the stage, so a one-argument call still compiles and
still gets this wrong.

**`sources` names any website that the answer read.** It is empty for almost
every answer. It holds a name only when the server was given reference sites.
See [reference sites](https://github.com/rulekitai/rulekit/blob/main/docs/reference-sites.md).

## Marking a claim from outside the corpus

A trace step that read a website carries a `source` object: the site name, the
exact address, and whether the site is official.

`AnswerTrace` renders it already. The open list names the site and links to the
page. The closed summary says that the answer read a source outside the rules
data. A reader who never opens the trace is the one who most needs to know. Both
marks use the `--rk-warning` CSS variable, so your theme controls them.

To build your own mark, call `readSources(message.steps)`. It returns one entry
for each SITE, and not for each page: three pages of one site is still one
source to weigh.

**Read this from the trace, and never from the answer text.** The model writes
the answer text, and the model is the thing that your reader checks. A mark
inside that text therefore proves nothing.

## Documentation

- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Reference sites](https://github.com/rulekitai/rulekit/blob/main/docs/reference-sites.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one.
