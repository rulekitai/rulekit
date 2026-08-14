# The ten rules the fetch enforces

Read this when you write your own `readPage`, when you debug a refusal, or when
you review the security of this feature. The library enforces all ten by
itself, so a normal setup needs none of this.

A model chooses the address, so treat every address as untrusted input.
`packages/rulekit/src/agent/references.ts` enforces each rule, and
`references.test.ts` tests each one with no network.

| # | Rule | It stops |
|---|---|---|
| 1 | https only | A rewritten page, and `file:` reading your disk |
| 2 | The host must be one you listed, or a subdomain of it | Reading anywhere else |
| 3 | The path must not start with a prefix you refused | Reading an address the site asks you to leave alone |
| 4 | Redirects are checked, then followed at most once | A site sending your server to an address inside your own network |
| 5 | No credentials | Your cookies reaching somebody's site |
| 6 | A timeout | One slow site holding a reader's question open |
| 7 | The content type must be readable text | A file that is not a page |
| 8 | A byte cap, applied while reading | A large page exhausting memory or your token budget |
| 9 | A per-question fetch count | A turn spending its budget on page reads |
| 10 | A cache by address | Reading one popular page on every question |

## Two rules that carry the most weight

**Rule 4 is the one people leave out.** A `fetch` that follows a redirect by
itself gives the site control of the allowlist, and an address such as
`169.254.169.254` reads the network your server runs in. Rules 2 and 3 run
again on wherever the redirect lands, so a permitted address cannot redirect
into a refused one.

**Rule 2 refuses a look-alike host.** `evilfaq.example.com` ends with the same
letters as `faq.example.com` and is a different site. The match tests the host
itself, or the host after a leading dot.

## A host must hold a dot, and nothing else

`defineReferenceTools` throws when it builds the tools, rather than when it
reads a page. `host: "com"` allows every address ending in `.com`, and
`host: "localhost"` points the assistant at the machine it runs on.

It also throws for a host holding a `/`, a `:`, or a space. Somebody who writes
`host: "example.com/cards"` wants the read limited to `/cards`, and the host
field cannot do that. Write `disallowPaths: ["/api/"]` for a path rule.

## What these rules do NOT do

- **Nothing reads `robots.txt`.** That file is where a site states which
  addresses an automatic reader may fetch. Read it yourself, copy each
  `Disallow` prefix into `disallowPaths`, and record the date you read it.
- **`maxFetchesPerTurn` is not a rate limit.** It caps one question. Pass your
  own `fetchImpl` for a limit across questions.

## A refusal is an ordinary result

The tool returns the refusal to the model, and the model answers from the
corpus. Nothing throws at read time, and the turn continues.

## Completion criterion

- `fetch_reference` reads a page from a host you listed.
- `fetch_reference` refuses a host you did not list, and names the ones allowed.
- `fetch_reference` refuses a path under `disallowPaths`, and names the prefix.
