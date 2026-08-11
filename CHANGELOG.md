# Changelog

Every change worth a reader's attention, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [semantic versioning](https://semver.org/spec/v2.0.0.html).
Both packages, `@rulekitai/rulekit` and `@rulekitai/ui`, ship from this
repository and carry one version between them, so one file records both.

This file starts at the entry below. Everything before it went out untagged,
while the packages were still being arranged, and writing a history for it now
would mean inventing one.

## [Unreleased]

Nothing yet.

## [0.3.0] - 2026-08-11

This release fixes a way for somebody to spend a host's model budget without
the count seeing it, and closes three smaller holes. It also makes card links
work at all, which they never had.

**One thing to change when you upgrade.** `exactCacheStage` no longer takes a
`version`. Move it to `createPipeline({ cacheVersion: "..." })`. Passing it to
the stage now raises an error that says so, rather than being ignored. If you
never set a cache version, you have nothing to change.

### Security

- **A failed question is now counted.** `Gate` is the one place a fork adds
  quotas and billing, and its `record` step was skipped whenever a turn produced
  no text. A turn spends money before it writes a word, because it reads the
  corpus first. So a turn that ran five lookups and then failed, or that reached
  its ceiling on model calls before the first word, cost the operator five calls
  and recorded none of them. Somebody asking questions that fail on purpose
  could spend a host's budget with nothing counting it. Both answer paths now
  record first and judge the answer afterwards.

- **The ask endpoint refuses a request from another site.** A browser will not
  send a cross-site request carrying a JSON content type until the server grants
  permission, and this endpoint grants none. An HTML form needs no permission
  and can post a JSON body as plain text. Where a host app knows a reader by
  their browser cookie, a page that reader merely visits could spend their
  quota. The endpoint now refuses a request that the browser itself marks as
  cross-site, using the `Sec-Fetch-Site` header that page scripts cannot set.
  Nothing that worked before stops working: reading this endpoint from another
  origin already needed permission headers that it does not send.

- **A card link may only name a relative path to an image.** A host app turns
  that path into a real address with a builder of its own. A model writes the
  answer and a corpus supplies the path, so neither is trusted. A path carrying
  its own scheme, such as `javascript:`, could otherwise become a link that runs
  code in a host app whose builder returns the path unchanged. A path opening
  with two slashes could name another site.

- **The Eve template compares its shared secret in constant time.** Comparing
  two strings with `===` stops at the first character that differs, so how long
  it takes reports how much of the secret was right.

### Fixed

- **Card links and card images now appear at all.** The Markdown renderer empties
  any address whose scheme it does not recognise, and `card:` is not one it
  recognises, so every card link arrived empty and rendered as plain text. The
  renderer is now told to keep that one scheme and to apply its own check to
  every other address.

- **A card name written with emphasis reaches a host app as the printed name.**
  A host app is handed a link's label as the card's name and looks the card up
  by it. A label is not always plain text: a model writes `[**Vi**](card:...)`
  often, and the old reading produced `[object Object]`, which names no card.

- **A gate that cannot record no longer costs the reader their answer.** The
  model has already been paid for, and on a streamed answer the text is already
  on screen. A counter that cannot be reached is a broken counter, not a broken
  answer. Every path now logs the failure and carries on.

- **A turn whose agent fails part way is now counted.** The path that returns one
  whole answer had no guard around the agent, so a failure left the request
  before anything recorded.

- **The cache version can be bumped.** Bumping it is how every stale answer
  becomes unreachable at once when a corpus changes. The reading stage held the
  number and the three writers ignored it, so a bump emptied the cache for good
  rather than once, and every question then went to the model with no error
  anywhere.

- **The browser tests run on a fresh clone.** They build the corpus database
  first. It is a build artefact and is not in version control, so a fresh clone
  held none, and the build then failed with a message naming neither the missing
  file nor the command that writes it.

### Changed

- **`createPipeline` takes `cacheVersion`.** This is now the one place the cache
  version is set. See `docs/adding-a-game.md`.

- **A cut-off answer is returned rather than discarded.** The path that returns
  one whole answer used to reply with an error when a turn wrote text but never
  reached a proper ending, throwing that text away. It now returns the text
  marked incomplete, which is what the streaming path already did. Nothing
  caches an answer marked that way.

### Removed

- **`exactCacheStage` no longer takes a `version`.** It moved to
  `createPipeline({ cacheVersion })`, because the reading stage and every writer
  must use the same number. Passing one now raises an error that names the
  replacement, rather than being ignored.
