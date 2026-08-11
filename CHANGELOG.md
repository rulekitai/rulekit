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

Somebody built a Riftbound rules bot with Vite and React, from the published
0.2.0 packages and nothing else, and wrote down every place the project failed
them. This release is that list, worked through. Most of it has one cause: the
documentation, the skills, and the command messages were written by people
standing inside this repository, and a reader who installs from npm stands
somewhere else, where `data/`, `docs/`, `packages/`, and `examples/` do not
exist.

**One thing to change when you upgrade.** Nothing, unless you passed
`--conditions=development` to run this project's source. That condition is now
called `rulekit-source`.

### Fixed

- **A Vite application can now install these packages and start.** Every
  subpath listed its TypeScript source under a condition named `development`.
  Vite matches that name with no instruction from anybody, so it loaded raw
  TypeScript out of `node_modules`, and pnpm keeps a package behind a symbolic
  link, from which the package cannot reach its own dependencies. The dev
  server then failed on every request, and neither message it printed named
  either rulekit package. The condition is now called `rulekit-source`, which
  no build tool matches unless it is asked. A test in each package fails if the
  old name comes back.

- **Four corpora now travel inside the package.** The skills promised five and
  the package held one, so anybody building an assistant for a real game had to
  clone this repository and copy a directory by hand, with nothing telling them
  to. `rulekit init <dir> --corpus <name>` now copies `demo`, `chess`,
  `texas-holdem`, or `estate-line`. All four carry a CC0 1.0 dedication. The
  Riftbound corpus stays here, because Riot Games owns that data and permits
  non-commercial use only, and the command says so when somebody asks for it.

- **The model provider's failure text no longer reaches the reader.** A
  provider writes its failures for whoever holds the account. With no
  credential set, readers saw the hosting company named, an account page
  linked, and instructions to run commands on a machine they do not have. With
  a spent budget they saw "Current spend: $10.00, limit: $10.00. Please contact
  your administrator", which is the operator's billing state. The reader now
  gets one plain sentence and the operator gets the detail in the server log.
  Pass `unavailableMessage` to `createAskHandler` to choose the sentence, or
  `(detail) => detail` on an internal tool where every reader is an operator.

- **The disclaimer can tell the truth.** `disclaimer` on `RuleKitProvider` now
  also takes a function, which receives whatever served the answer. One fixed
  sentence saying an AI wrote the answer was false for most answers, because
  most answers come from the free stages where no model runs, and it sat
  directly under a trace line saying the answer was read from the rules data.
  `answerSource` in `@rulekitai/ui/message` turns a stage name into `"rules"`
  or `"model"`.

- **Every document a shipped message names can now be opened.** The help text,
  the `init` and `eval` messages, and the notice inside the Riftbound corpus
  all named `docs/corpus-format.md`, which npm does not carry. They now give
  the full address. The notice reaches end users through some applications, so
  that one was a dead path shown to readers with no directory at all.

- **A missed question names a README section that exists.** It sent readers to
  "Run it", which no README has had for some time. A test now reads the
  headings out of the README and fails if the message drifts again.

### Added

- **`rulekit --version`, and `rulekit ask <dir> "<question>" --json`.** A script
  can now check which version it calls and read a field out of an answer,
  rather than matching prose with a pattern.

- **A root import that explains itself.** `import ... from "@rulekitai/rulekit"`
  failed in the module resolver, which named no subpath and showed no example.
  Both packages now throw a sentence that lists the subpaths.

- **`hideSqliteExperimentalWarning` from `@rulekitai/rulekit/sqlite-warning`.**
  Node marks its own SQLite module experimental and announces it before your
  server starts. The command has hidden that one warning for a while; a host
  application can now do the same in one line, and keep every other warning.
  The library never calls it: which warnings a program prints is the program's
  decision.

- **A browser test that a card link reaches the host's card renderer.** The
  whole card feature did nothing before 0.3.0 and no test noticed, because a
  card's name is printed either way and reading the answer cannot tell the
  difference. The example application now draws cards with its own component,
  which is also the answer for anybody whose corpus has no pictures: no corpus
  ships any, because the pictures belong to whoever owns the game.

### Changed

- **The six skills now say where the reader is standing.** Every command and
  path had one form, and it was the one that only works inside this repository.
  Each now gives the `npx` form for an installed package beside the `pnpm` form
  for a clone.

- **The skills describe both shapes the ask endpoint answers in.** A question a
  free stage answers returns one JSON object with no `type` field; only a
  question that reaches the agent returns lines. The `rulekit-serve` skill
  documented the lines alone, and its own example question takes the other
  path, so following it exactly produced the opposite of what it predicted.

- **The README no longer makes `ai` look optional.** The agent answers every
  question the free stages miss, so nearly every real application installs it.

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
