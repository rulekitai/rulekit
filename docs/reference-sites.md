# Reference sites

No corpus holds every ruling. When yours holds no answer, rulekit says so and
stops. A reference site lets rulekit read a website first.

**rulekit ships no reference site, recommends none, and endorses none.** You
name every site. You accept that site's terms of use, and you control how often
you read it.

## What changes when you switch this on

| Off, which is the default | On |
|---|---|
| The server makes one outbound call, to your model | The server can also read the hosts you list |
| Every claim traces to your corpus | A claim can trace to a website, and says so |
| Two tools do not exist | `list_references` and `fetch_reference` exist |

The corpus stays the source of truth. A page from a site is a SECOND source. The
answer names the site, gives its address, and says whether the site is official.
The answer also states that the claim did not come from your rules data.

## Decide first

### 1. Does the site permit it?

Read its terms. A site with no statement did not say yes. Send a `userAgent`
that names you and gives a contact address. The operator can then see who reads
the site, and can refuse you.

### 2. Can you own the content instead?

A ruling you may copy belongs in `rulings.json`, inside your corpus.

| In your corpus | On somebody's website |
|---|---|
| Answers in milliseconds, with no model call | Costs one page read on every miss |
| `rulekit validate` checks it | Nothing checks it |
| Stays as you wrote it | The owner can edit it or delete it |
| Cited as your own rules data | Marked as an outside claim |

See [the corpus format](corpus-format.md) for `rulings.json`. Name a reference
site when somebody else owns the content.

### 3. Can your reader see the difference?

Your reader sees it only if your interface shows it. Read "Show the reader"
below. If you skip that step, a labelled second source becomes an unlabelled
claim.

## Configure the sites

```ts
import type { ReferenceSite } from "@rulekitai/rulekit/agent/references"
import { createRulesAgent } from "@rulekitai/rulekit/agent/runtime"
import { MemoryCache } from "@rulekitai/rulekit/pipeline/cache"

const REFERENCE_SITES: ReferenceSite[] = [
  {
    name: "Example FAQ",
    host: "faq.example.com",
    describes: "Community rulings for Example, with rule citations.",
    official: false,
    cardPath: "/cards/{slug}",
  },
]

const agent = createRulesAgent({
  store,
  profile,
  model: "anthropic/claude-sonnet-5",
  references: {
    sites: REFERENCE_SITES,
    cache: new MemoryCache(),
    timeoutMs: 5_000,
    maxBytes: 200_000,
    maxFetchesPerTurn: 3,
    userAgent: "my-app (+https://example.com/contact)",
  },
})
```

**Pass the sites through the `references` option. Do not pass them through
`extraTools`.** The `references` option adds the two tools AND an instruction
block. That block tells the model to name the site and to mark the claim as
outside your rules data. The tools without the block produce an answer that
cites a website as though it were your rulebook. Nothing after that point can
separate the two.

### The site fields

| Field | What it does |
|---|---|
| `name` | Names the site in the answer and in the trace |
| `host` | The allowlist. No scheme, no path, and it must hold a dot |
| `describes` | The one sentence the model reads to choose this site |
| `official` | Shown to the reader. False by default |
| `cardPath` | An address hint. `{slug}` becomes the folded piece name |
| `disallowPaths` | Addresses under any of these prefixes are refused |

**Leave `official` false unless the game's publisher writes the site.** True
tells a reader that the claim carries the publisher's authority. The reader
cannot check that claim.

**`host` takes a host and nothing else.** No scheme, no path, no space. A value
such as `example.com/cards` is refused when the tools are built, because a
person who writes it wants the read limited to `/cards`, and the host field
cannot do that. Use `disallowPaths` instead.

**Write `robots.txt` into `disallowPaths` yourself.** That file is where a
website states which addresses an automatic reader may fetch. Read it, copy each
`Disallow` prefix into the list, and record the date you read it in a comment.
The site may change the file, and nothing here rereads it:

```ts
{
  name: "Example FAQ",
  host: "faq.example.com",
  // robots.txt read 2026-08-14: User-Agent: *, Allow: /, Disallow: /api/
  disallowPaths: ["/api/"],
}
```

### The option fields

| Field | Default | What it does |
|---|---|---|
| `sites` | required | An empty list adds no tool and makes no call |
| `cache` | none | Without one, the server reads a popular page for every question |
| `cacheTtlSeconds` | 3600 | How long the cache holds a fetched page |
| `timeoutMs` | 5000 | How long one page may take |
| `maxBytes` | 200000 | The cap, applied while reading |
| `maxFetchesPerTurn` | 3 | Page reads for each question |
| `userAgent` | names rulekit | Write your own contact address here |
| `readPage` | strips HTML | Your own parser. See below |
| `fetchImpl` | global `fetch` | A stub, for a test that needs no network |

The list of sites belongs to the agent, and not to `profile.json` or a corpus
file. [Design decisions](design-decisions.md) gives the three reasons.

## The ten rules on every fetch

A model chooses the address, so treat every address as untrusted input.
`agent/references.ts` enforces each rule below, and each rule has its own test.

| # | Rule | What it prevents |
|---|---|---|
| 1 | `https` only | A page rewritten in transit, and `file:` reading your disk |
| 2 | The host must be one you list, or a subdomain of it | A read of any other address |
| 3 | The path must not start with a prefix you refused | A read of an address the site asks you to leave alone |
| 4 | The code checks a redirect, then follows it at most once | A site that sends your server to an address inside your own network |
| 5 | No credentials | Your cookies reaching somebody's site |
| 6 | A timeout | One slow site that holds a reader's question open |
| 7 | The content type must be readable text | A file that is not a page |
| 8 | A byte cap, applied while reading | A large page that exhausts memory or your token budget |
| 9 | A fetch count for each question | A turn that spends its whole budget on page reads |
| 10 | A cache by address | A read of one popular page for every question |

**Rule 4 is the rule a hand-written version leaves out.** A `fetch` that follows
a redirect by itself gives the site control of your allowlist. An address such
as `169.254.169.254` then reads the network that your server runs in. Rules 2
and 3 run again on wherever the redirect lands, so a permitted address cannot
redirect into a refused one.

**Two things these rules do NOT do.**

- **Nothing reads `robots.txt`.** Read it yourself and write what it forbids
  into `disallowPaths`, as shown above.
- **`maxFetchesPerTurn` is not a rate limit.** It caps ONE question. Ten readers
  asking three questions each still make thirty reads. Pass your own `fetchImpl`
  when you need a limit across questions; every fetch this package makes goes
  through it.

`defineReferenceTools` refuses a host with no dot when it builds the tools, and
not when it reads a page. `host: "com"` allows every address that ends in
`.com`. `host: "localhost"` points the assistant at the machine it runs on.

A refused address is an ordinary result, and not a crash. The model reads the
refusal and answers from your corpus.

## Show the reader

A step that read a site carries a `source` object: the site name, the exact
address, and whether the site is official. Read that object from the trace.
**Never read it from the answer text.** The model writes the answer text, and
the model is the thing your reader checks.

`AnswerTrace` marks these steps already. It names the site in the open list, and
it says so in the closed summary. A reader who never opens the trace still sees
the mark.

For the note under the answer, `disclaimer` receives the sites as its second
argument:

```tsx
<RuleKitProvider
  disclaimer={(servedBy, sources) =>
    sources.length
      ? `Also read ${sources.map((s) => s.name).join(", ")}, which is outside the rules data.`
      : "Read from the rules data."
  }
/>
```

Outside React, call `readSources(message.steps)` from `@rulekitai/ui/message`,
or read `step.source` from the `step` events on the stream.

## Parse a page your own way

The built-in reader removes scripts, styles, navigation, and footers. It then
drops the remaining tags and decodes the common entities. That is enough for a
question-and-answer page, and it adds no dependency to your install.

```ts
references: {
  sites: REFERENCE_SITES,
  readPage: (body, contentType) => myParser(body, contentType),
}
```

Write `readPage` when a site publishes JSON or Markdown, or when its text does
not survive the built-in reader.

## Failures, and the cause of each

| What you see | Cause |
|---|---|
| No `fetch_reference` tool | `sites` is empty. An empty list adds no tool |
| "names no single site" at start up | A configured host has no dot. Write the whole host |
| "is not a reference site" | The host is not on your list, or the model guessed an address |
| "Only https addresses may be read" | The model built an `http:` address |
| "redirected more than once" | The site chains redirects. Name the final address |
| "is not a readable page" | The address answers with a file rather than a page |
| "You have read 3 reference pages" | The cap for one question. Raise `maxFetchesPerTurn` |
| The answer cites a site as though it were your rules | You passed the tools through `extraTools`, so the instruction block is absent |
| The reader never learns that the server read a site | Your disclaimer ignores its second argument |

`rulekit eval` reads no reference site, and it offers no flag to add one. See
[verifying answers](verifying-answers.md) for the two reasons.

## Read next

- [The corpus format](corpus-format.md) for `rulings.json`, which holds content you own
- [Architecture](architecture.md) for the place of this step in one turn
- [Verifying answers](verifying-answers.md) for what the eval proves
- [Design decisions](design-decisions.md) for why the site list is not a corpus field
