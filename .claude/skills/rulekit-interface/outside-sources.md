# Mark a claim that came from outside the corpus

Read this when the server names reference sites. `rulekit-references` switches
them on. An app with none configured never reaches this screen.

A step that read a website carries a `source` object:

```ts
step.source // { name: "Example FAQ", url: "https://…", official: false }
```

## The shipped components already do it

`AnswerTrace` renders the mark twice. The open list names the site and links to
the page. The closed summary also says that the answer read a second source,
because a reader who never expands the trace most needs to know.

Both marks read one CSS variable, so a theme restyles them:

```css
--rk-warning: #a15c07;
```

## Building your own

In React, call `readSources(message.steps)` from `@rulekitai/ui/message`. It
returns one entry per SITE rather than per page, because three pages of one site
is still one source for a reader to weigh.

Outside React, read `step.source` off the `step` events on the stream.

**Read this off the trace.** The model writes the answer, and the model is the
thing your reader is checking, so a marker built from a sentence the model chose
to write proves nothing.

## Completion criterion

- An answer that read a site names that site under the answer.
- The closed trace summary says a second source was read, with the trace never
  expanded.
- An answer that read no site mentions none.
