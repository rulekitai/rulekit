---
name: rulekit-interface
description: Build the chat interface for a rulekit endpoint, at one of three levels: the styled components, the headless React hooks, or the raw event stream for a framework that is not React. Covers card links, card images, the disclaimer, and saved conversations. Use when the user wants a rules chat interface, mentions `useAskStream`, `RuleKitProvider`, or `<Chat />`, asks how to render card links in an answer, or needs to read the answer stream from Vue, Svelte, or plain JavaScript.
---

# Build the interface

## Step 1: pick the level

| Level | Use | When |
|---|---|---|
| Styled | `@rulekit/ui` | The fastest. Themed with CSS variables. |
| Headless | `@rulekit/react` | Their own design system. No styling ships. |
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

Copy `examples/next-app/app/ask-screen.tsx`. It is the whole interface, and it
holds the two behaviours that are easy to miss:

- The view follows a growing answer only while the reader sits at the bottom.
- Opening another conversation during an answer does not save that answer into
  the conversation the reader just opened.

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

## Step 4, raw stream: four message types

The endpoint returns one JSON object per line.

| `type` | Carries | Do |
|---|---|---|
| `step` | A tool the model called | Show progress. |
| `text` | The answer so far | Replace the answer. |
| `done` | The final answer | Stop, and save. |
| `error` | A message | Show it. Save nothing. |

Read the body line by line and parse each line. `@rulekit/agent/events` holds
`decodeEvents` if the client runs JavaScript.

## Step 5: connect the app's own pieces

A corpus stores a card image as a **relative path**, because it does not know
where the images live. Nothing renders until the app says.

```tsx
<RuleKitProvider
  cardScheme="card"                                  // must match profile.json
  cardImageUrl={(path) => `${CDN}/${path}`}
  renderers={{ /* the app's own card component */ }}
  legalNote={<TheirNotice />}
/>
```

**`cardScheme` must match `cards.linkScheme` in the profile.** A mismatch shows
a card link as plain text.

## Completion criterion

All four are true:

- A rule question answers, and shows the rule number.
- A card question shows the card, with the app's own image and link.
- A failed request shows a message, and no failed turn is saved.
- A reload keeps the conversation.

## Next

- The endpoint: `rulekit-serve`
