---
name: rulekit-interface
description: Build the chat interface for a rulekit endpoint, with styled components, headless React hooks, or the raw event stream. Use when the user wants a rules chat interface, names `useAskStream`, `RuleKitProvider`, `<Chat />`, or `AnswerTrace`, or reads the answer stream from Vue, Svelte, or plain JavaScript.
---

# Build the interface

## Step 1: pick the level

| Level | Use | When |
|---|---|---|
| Styled | `@rulekitai/ui` | The fastest. Themed with CSS variables. |
| Headless | `@rulekitai/ui`, hooks only | Their own design system. Import the hooks and none of the components. |
| Raw stream | Read the response | Vue, Svelte, plain JavaScript, or a mobile app. |

Read the raw stream when React is absent. The hooks already hold the parts that
are easy to get wrong.

## Step 2, styled: three components

```tsx
<RuleKitProvider cardScheme="card" renderers={{ card: CardChip }}>
  <ChatSessionList
    sessions={sessions.sessions}
    currentId={sessions.currentId}
    onOpen={openChat}
  />
  <Chat messages={messages} loading={loading} streaming={streaming} onAsk={onAsk} />
</RuleKitProvider>
```

Neither package ships an example screen. Copy the one in the repository:
<https://github.com/rulekitai/rulekit/blob/main/examples/next-app/app/ask-screen.tsx>

It is the whole interface, and it holds three behaviours that are easy to miss:

- The view follows a growing answer only while the reader sits at the bottom.
- Opening another conversation during an answer saves that answer into the
  conversation the reader asked it in.
- The note under an answer changes with what answered it. See step 5.

**Criterion:** a question streams into the page, and a reload keeps the
conversation.

## Step 3, headless: two hooks

```tsx
const sessions = useChatSessions()
const { messages, loading, streaming, ask } = useAskStream({
  endpoint: "/api/ask",
  persistTurn: async (chatId, transcript, newTurn) => {
    await sessions.persistTurn(chatId, transcript, newTurn)
  },
  onError: (error) => show(error.message),
})
```

**Pass the conversation to `ask`:** `ask(question, sessions.currentId)`. The
reader may open another conversation before the answer arrives.

## Step 4, raw stream: two shapes, then four message types

**READ THE CONTENT TYPE FIRST.** The endpoint answers in two shapes, and the
cheap one is the common one. A client that reads lines only fails on most
answers.

| Content type | The body | It means |
|---|---|---|
| `application/json` | One object, with no `type` field | A free stage answered. Show it and stop. |
| `application/x-ndjson` | One JSON object per line | The agent is writing. Read the lines. |

The lines of the streaming shape carry four message types:

| `type` | Carries | Do |
|---|---|---|
| `step` | A tool the model called | Show progress. Mark a step carrying `source`. |
| `text` | The answer so far | Replace the answer. |
| `done` | The final answer | Stop, and save. |
| `error` | A message for the reader | Show it. Save nothing. |

A `step` carries `source` only when that call read something OUTSIDE the corpus.
It holds the site name, the exact address, and whether the site is official. It
is absent from almost every step. **A client that reads `source` keeps an
outside claim distinct from the rules data.** See step 5.

`@rulekitai/rulekit/agent/events` holds `decodeEvents` for a client that runs
JavaScript.

The endpoint keeps the model provider's own words in the server log, so the
`error` message carries no cause.

## Step 5: connect the app's own pieces

A corpus stores a card image as a **relative path**, because it does not know
where the images live. Nothing renders a card image until the app supplies
`cardImageUrl`.

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

The pictures belong to whoever owns the game, so `cardImageUrl` has nothing to
point at until the app hosts its own copies.

**Draw the name instead.** It works with every corpus, and a reader still sees
that the assistant matched a real card:

```tsx
function CardChip(card: { name: string; path: string; inline: boolean }) {
  return <span className="card-chip" title={card.path}>{card.name}</span>
}
```

### Say something true under the answer

`disclaimer` takes one node, or a function. Take the function: it receives two
things that change what is true of the answer above it.

```tsx
import { answerSource, type ReadSource } from "@rulekitai/ui/message"

const disclaimerFor = (servedBy: string, sources: ReadSource[]) => {
  const base =
    answerSource(servedBy) === "model"
      ? "Written by an AI from the rules data. Check anything that decides a game."
      : "Read from the rules data, with no AI. Check anything that decides a game."
  if (!sources.length) return base
  const named = sources.map((s) => `${s.name}${s.official ? "" : " (unofficial)"}`).join(", ")
  return `${base} This answer also read ${named}, which is outside the rules data.`
}
```

**`servedBy` decides whether a model wrote the answer.** Most answers come from
the free stages, where no model runs, and one fixed sentence about an AI then
contradicts the trace line directly above it.

**`sources` names any website the answer read.** It is empty for almost every
answer. When it holds a site, say so: a reader weighs a claim from somebody's
site differently from a rule, and this is the only place your app can tell them.

### Marking a claim that came from a second source

A step that read a website carries a `source` object, and `AnswerTrace` renders
it already. Read [`outside-sources.md`](outside-sources.md) beside this file
when the server names reference sites. An app with none configured needs
nothing here.

## Completion criterion

All five are true:

- A rule question answers, and shows the rule number.
- A card question reaches the app's own card renderer, so the card draws as a
  component. Test the component. The card's name prints either way, so reading
  the answer's text cannot tell the difference.
- A failed request shows a message, and no failed turn is saved.
- A reload keeps the conversation.
- With reference sites on, an answer that read one names the site both in the
  trace and under the answer. With none configured, no answer names a site.

## Next

- The endpoint: `rulekit-serve`
- Reading a website when the corpus misses: `rulekit-references`
