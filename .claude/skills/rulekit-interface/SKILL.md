---
name: rulekit-interface
description: Build the chat interface for a rulekit endpoint, at one of three levels: the styled components, the headless React hooks, or the raw event stream for a framework that is not React. Covers card links, card images, the disclaimer, and saved conversations. Use when the user wants a rules chat interface, mentions `useAskStream`, `RuleKitProvider`, or `<Chat />`, asks how to render card links in an answer, or needs to read the answer stream from Vue, Svelte, or plain JavaScript.
---

# Build the interface

## Step 1: pick the level

| Level | Use | When |
|---|---|---|
| Styled | `@rulekitai/ui` | The fastest. Themed with CSS variables. |
| Headless | `@rulekitai/ui`, hooks only | Their own design system. Import the hooks and none of the components. |
| Raw stream | Read the response | Vue, Svelte, plain JavaScript, or a mobile app. |

Read the raw stream only when React is absent. The hooks already hold the parts
that are easy to get wrong.

## Step 2, styled: three components

```tsx
<RuleKitProvider cardScheme="card" cardImageUrl={(p) => `https://cdn.example.com/${p}`}>
  <ChatSessionList {...sessions} />
  <Chat messages={messages} onAsk={ask} streaming={streaming} />
</RuleKitProvider>
```

Neither package ships an example screen, so read the one in the repository and
copy from it:
<https://github.com/rulekitai/rulekit/blob/main/examples/next-app/app/ask-screen.tsx>

It is the whole interface, and it holds the behaviours that are easy to miss:

- The view follows a growing answer only while the reader sits at the bottom.
- Opening another conversation during an answer does not save that answer into
  the conversation the reader just opened.
- The note under an answer changes with what answered it. See step 5.

**Criterion:** a question streams into the page, and a reload keeps the
conversation.

## Step 3, headless: two hooks

```tsx
const sessions = useChatSessions()
const { messages, loading, streaming, ask } = useAskStream({
  endpoint: "/api/ask",
  persistTurn: sessions.persistTurn,
  onError: (e) => show(e.message),
})
```

`ask(question, sessions.currentId)` takes the conversation the question belongs
to. Pass it. The reader may open another conversation before the answer arrives.

## Step 4, raw stream: two shapes, then four message types

**READ THE CONTENT TYPE FIRST.** The endpoint answers in two shapes, and the
cheap one is the common one. A client that reads lines only will fail on most
answers.

| Content type | The body | It means |
|---|---|---|
| `application/json` | One object, with no `type` field | A free stage answered. Show it and stop. |
| `application/x-ndjson` | One JSON object per line | The agent is writing. Read the lines. |

```jsonc
// The whole body of a cheap answer. There is no stream and no done event.
{"text":"…","citations":[…],"source":"glossary","servedBy":"glossary","latencyMs":9,"model":null}
```

The lines of the streaming shape carry four message types:

| `type` | Carries | Do |
|---|---|---|
| `step` | A tool the model called | Show progress. |
| `text` | The answer so far | Replace the answer. |
| `done` | The final answer | Stop, and save. |
| `error` | A message for the reader | Show it. Save nothing. |

Read the body line by line and parse each line. `@rulekitai/rulekit/agent/events` holds
`decodeEvents` if the client runs JavaScript.

The `error` message is written for the reader. The endpoint keeps the model
provider's own words in the server log, so do not expect a cause here.

## Step 5: connect the app's own pieces

A corpus stores a card image as a **relative path**, because it does not know
where the images live. Nothing renders until the app says.

```tsx
<RuleKitProvider
  cardScheme="card"                                  // must match profile.json
  cardImageUrl={(path) => `${CDN}/${path}`}          // only if the app hosts pictures
  renderers={{ card: CardChip }}                     // the app's own card component
  disclaimer={disclaimerFor}                         // see below
  legalNote={<TheirNotice />}
/>
```

**`cardScheme` must match `cards.linkScheme` in the profile.** A mismatch shows
a card link as plain text.

### No corpus ships card pictures

Every corpus stores paths and no images, because the pictures belong to whoever
owns the game. So `cardImageUrl` has nothing to point at until the app hosts
its own copies, and it is legal for the app to do so.

**Draw the name instead.** It works with every corpus, and a reader still sees
that the assistant matched a real card:

```tsx
function CardChip(card: { name: string; path: string; inline: boolean }) {
  return <span className="card-chip" title={card.path}>{card.name}</span>
}
```

### Say something true under the answer

`disclaimer` takes one node, or a function that receives what served the
answer. Take the function. Most answers come from the free stages, where no
model runs, and one fixed sentence about an AI then contradicts the trace line
directly above it:

```tsx
import { answerSource } from "@rulekitai/ui/message"

const disclaimerFor = (servedBy: string) =>
  answerSource(servedBy) === "model"
    ? "Written by an AI from the rules data. Check anything that decides a game."
    : "Read from the rules data, with no AI. Check anything that decides a game."
```

## Completion criterion

All four are true:

- A rule question answers, and shows the rule number.
- A card question reaches the app's own card renderer, so the card is drawn as
  a component and not as plain text. Test that, and not the text: the card's
  name is printed either way, so reading the answer cannot tell the difference.
- A failed request shows a message, and no failed turn is saved.
- A reload keeps the conversation.

## Next

- The endpoint: `rulekit-serve`
