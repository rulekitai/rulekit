---
name: rulekit-references
description: Let the agent read websites outside the corpus when the corpus has no answer. Use when the user wants the agent to read a rulings site or a FAQ site, or names `references`, `defineReferenceTools`, `fetch_reference`, or `list_references`.
---

# Reference sites

When a corpus misses, rulekit says so and stops. A reference site lets it read a
website first, as a **second source**.

**rulekit ships no reference sites, recommends none, and endorses none.** You
name every site, and naming one makes you responsible for its terms of use and
for how often you read it.

## What changes when you turn this on

| Off (the default) | On |
|---|---|
| The agent makes one outbound call, to your model | It can also read the hosts you listed |
| Every claim traces to your corpus | A claim can trace to somebody's website, and says so |
| Two extra tools do not exist | `list_references` and `fetch_reference` exist |

The corpus stays the source of truth. A page read from a site is a SECOND
source: the answer names the site, gives its address, says whether the site is
official, and states that the claim is not from the rules data.

## Step 1. Decide whether you should

Ask three questions before you write any code.

1. **Does the site permit it?** Read its terms. A site with no statement is not
   a site that said yes.
2. **Would you rather own the content?** A ruling you can copy belongs in
   `rulings.json`. There it answers in milliseconds, costs nothing, and
   `rulekit validate` checks it. A page on somebody's website costs a round trip
   on every miss, and its owner can edit or remove it. Open `rulekit-corpus` to
   own it, and name a reference site when the content is somebody else's to
   keep.
3. **Can your reader tell the difference?** They can only if your interface
   shows it. Step 5 covers that, and skipping it is the failure that matters
   most here.

## Step 2. Name the sites

```ts
import type { ReferenceSite } from "@rulekitai/rulekit/agent/references"

const REFERENCE_SITES: ReferenceSite[] = [
  {
    name: "Example FAQ",              // what an answer calls it
    host: "faq.example.com",          // this host and its subdomains ONLY
    describes: "Community rulings for Example, with rule citations.",
    official: false,                  // false unless the publisher wrote it
    cardPath: "/cards/{slug}",        // optional: how a name becomes a page
  },
]
```

| Field | It does |
|---|---|
| `name` | Names the site in the answer and in the trace |
| `host` | The allowlist. No scheme, no path |
| `describes` | The one sentence the model reads to choose this site |
| `official` | Shown to the reader. Default false |
| `cardPath` | A hint for building an address. `{slug}` is the folded name |

**Write the whole host, such as `faq.example.com`.** A host with no dot, such as
`com` or `localhost`, allows every address underneath it, so
`defineReferenceTools` throws on such a host before it reads any page.

**Leave `official` false unless the game's publisher writes the site.** True
tells a reader the claim carries the publisher's authority, which is a claim
they cannot check for themselves.

## Step 3. Pass them to the agent

```ts
import { createRulesAgent } from "@rulekitai/rulekit/agent/runtime"
import { MemoryCache } from "@rulekitai/rulekit/pipeline/cache"

const agent = createRulesAgent({
  store,
  profile,
  model: MODEL,
  references: {
    sites: REFERENCE_SITES,
    cache: new MemoryCache(),   // without one, every question refetches
    timeoutMs: 5_000,
    maxBytes: 200_000,
    maxFetchesPerTurn: 3,
    userAgent: "my-app (+https://example.com/contact)",
  },
})

// An empty `sites` list adds no tools and makes no call. This line is safe to
// leave in place before you have chosen a site.
```

**Pass the sites through the `references` option.** It adds the tools AND the
instruction block that makes the model label an outside claim as one. Tools
built by hand and passed through `extraTools` carry no such block. The answer
then cites somebody's website as though it were the rules, and nothing
downstream can tell.

## Step 4. Trust the allowlist, and know one rule

A model chooses the address, so `agent/references.ts` treats every address as
untrusted input. Nine rules hold, and `references.test.ts` tests each one with
no network. You configure none of them.

Read [`fetch-rules.md`](fetch-rules.md) beside this file when you write your own
`readPage`, debug a refusal, or review this feature's security.

**Rule 3 is the one a hand-written version leaves out.** A `fetch` that follows
a redirect by itself gives the site control of the allowlist, and an address
such as `169.254.169.254` reads the network your server runs in. rulekit checks
a redirect against the allowlist, then follows it at most once.

## Step 5. Show the reader

A step that read a site carries a `source` object: the name, the exact address,
and whether the site is official.

```tsx
<RuleKitProvider
  disclaimer={(servedBy, sources) =>
    sources.length
      ? `Also read ${sources.map((s) => s.name).join(", ")}, outside the rules data.`
      : "Read from the rules data."
  }
/>
```

The shipped `AnswerTrace` already marks these steps and names the site, in the
closed summary and in the open list.

**Read the source off the TRACE**, where the tool that read the page wrote it.
`rulekit-interface` holds the full disclaimer, `readSources`, and the trace.

## Step 6. Parse a page your own way, when you need to

The built-in reader removes scripts, styles, navigation, and footers, drops the
remaining tags, and decodes the common entities. That is enough for a
question-and-answer page, and it adds no dependency.

```ts
references: {
  sites: REFERENCE_SITES,
  readPage: (body, contentType) => myParser(body, contentType),
}
```

Supply `readPage` when a site publishes JSON or Markdown, or when its text does
not survive the built-in reader.

## `rulekit eval` reads no reference site

It builds an agent with none and offers no way to add one. Both of its checks
compare an answer against the CORPUS, and a live page makes a run different
every time. So a score there says nothing about the assistant with reference
sites on. Check that by hand, and see `rulekit-verify`.

## Failures, and what causes each

| What you see | Cause |
|---|---|
| No `fetch_reference` tool | `sites` is empty. An empty list adds no tools |
| "is not a reference site" | The host is not on your list. Add it, or the model guessed |
| "Only https addresses may be read" | The model built an `http:` address |
| "redirected more than once" | The site chains redirects. Point at the final address |
| "is not a readable page" | The address answers with a file, not a page |
| "You have read 3 reference pages" | The per-question cap. Raise `maxFetchesPerTurn` |
| The answer cites a site as though it were the rules | The tools came through `extraTools`, so the instruction block is missing. Use `references` |
| The reader is not told a site was read | Your disclaimer ignores its second argument. See step 5 |

## Completion criterion

This is done when all five are true:

- `list_references` names your sites, and reads no page to do it.
- `fetch_reference` reads a page from a host you listed.
- `fetch_reference` refuses a host you did not list, and names the ones allowed.
- An answer that read a site names it and says the claim is outside the rules
  data.
- The trace shows the outside marker without anybody expanding it.
