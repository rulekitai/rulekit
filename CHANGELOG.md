# Changelog

Every change worth a reader's attention, newest first.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project follows [semantic versioning](https://semver.org/spec/v2.0.0.html).
Both packages, `@rulekitai/rulekit` and `@rulekitai/ui`, ship from this
repository and carry one version between them, so one file records both.

The record starts at the first tagged entry below. Everything before it went out
untagged, while this project still arranged the packages. A history written now
would be an invented one.

## [Unreleased]

## [0.5.0] - 2026-08-14

The same reader took this build, deleted every workaround they had written, and
reported again. Fifteen of their seventeen issues were closed; the entries below
close the rest, and the five things they found on the way.

A player asked whether rulekit answers the harder questions, and named a
community rulings site. Two parts were missing. A corpus held no place for a
ruling. When a corpus missed, the assistant stopped, and looked nowhere else.

### Added

- **Rulings are a collection.** A new `rulings.json` holds a question, an
  answer, the rule numbers the answer rests on, who published it, and whether it
  is official. A rule is the published text, and an erratum changes that text. A
  ruling reads the unchanged text and says what it means in one case. That shape
  differs from the other two, so it needs its own file. One `kind` field
  separates the three uses: `card` for named pieces, `general` for a mechanic or
  a timing, and `policy` for running an event rather than playing a game.
- **`rulings.json` may be absent.** It is the ONE collection file a corpus can
  leave out, because every corpus written before it holds no such file. Every
  other missing file still fails the load.
- **`rulekit validate` names any JSON file the format does not know.** This
  check pays for the exception above: the command now reports `rulingz.json`,
  rather than reading the corpus as "this game has no rulings". It also checks a
  ruling's card ids, its rule numbers, that a `card` ruling names a card, and
  that a `source_url` is an `https` address.
- **A `list_rulings` tool**, offered only when the corpus holds a ruling, and a
  `rulings_lookup` procedure. The procedure tells the model to read the rules a
  ruling cites before it quotes the ruling, and to report whether the ruling is
  official.
- **The free stages answer "rulings for X"**, with no model call. The stage
  refuses to report "no rulings" for a name that no card carries, exactly as the
  ban verdict refuses to call an unknown name legal.
- **Reference sites**: `createRulesAgent({ references })` lets an implementer
  name websites the agent may read when the corpus misses. **rulekit ships no
  sites and endorses none.** It is a runtime option and never a corpus field,
  because a copied corpus must not grant a server outbound network access. The
  option adds an instruction block as well as the tools. Without that block, the
  model cites a fetched page as though it were the rules.
- **Ten rules on every fetch**, and each rule has a test that needs no network:
  `https` only; a host allowlist that accepts subdomains and refuses
  look-alikes; a path prefix the operator refused; a redirect checked, and
  followed at most once; no credentials; a timeout; a content-type check; a byte
  cap applied while reading; a count for each question; and a cache by address.
- **An outside claim is marked outside the model's prose.** The tool writes the
  site, the address, and whether it is official onto its trace step. The trace
  says so in its closed summary, and `readSources` in `@rulekitai/ui/message`
  gives a host app the list for its disclaimer. The model writes the answer, and
  the model is what a reader checks, so a marker carried in prose proves
  nothing.
- **`data/demo` and `data/chess` ship rulings**, covering all three kinds.
  `data/riftbound` ships an empty list: the community site that prompted this
  work belongs to a third party, and this project copied nothing from it.
- **The Eve template offers `list_rulings` too.** Eve names a tool after its
  file and reads the directory rather than a list, so the template needed
  `agent/tools/list_rulings.ts`. Without it, the two runtimes offered different
  tools: the chess corpus got 10 on the AI SDK and 9 on Eve.
- **`eveSkill` in the Eve template drops a procedure whose tool is absent.** Eve
  reads every file under `agent/skills/` and cannot leave one out, so a corpus
  with no ruling still received a procedure naming `list_rulings`, and the model
  called a tool that was not there. `card_lookup` carried the same fault for a
  profile with no cards, and now uses the same guard.
- **`templates/eve-agent/.env.example` exists.** The template README told a
  reader to copy that file, and no such file was in the repository.
- **Both published packages now carry the `NOTICE` file.** npm adds `LICENSE`
  by itself and adds no `NOTICE`, and `files` reads paths inside the package
  directory only, so the file at the root of the repository never travelled.
  Apache 2.0 section 4(d) asks that it does, and the README already said it did.
  The build copies it into each package.
- **`docs/`, `CHANGELOG.md`, and the eight skills now travel inside
  `@rulekitai/rulekit`.** The README links seven documents, and a reader who
  installed from npm could open none of them: `files` reads paths inside the
  package directory only, and every document sat at the root of this repository.
  The README was then the whole documentation set for three features it does not
  fully explain. `@rulekitai/ui` ships the changelog too. Three tests hold this
  in place: every relative link names a file, every link into this project's own
  branch names a file, and every document the published README links is inside
  the shipped `files`.
- **A ruling answers its own question, free.** Ask the exact question a ruling
  asks and the answer arrives from the rows in a few milliseconds, with no model
  call. Both sides are folded for case, spacing, accents, and a final question
  mark. The match is EQUALITY and never a search: a ruling that merely resembles
  the question goes to the agent, because a published question and answer belong
  to each other, and pairing one publisher's answer with a question it was not
  written for states something nobody published. `RuleStore` gained an optional
  `getRulingByQuestion`, and both stores implement it.
- **`disallowPaths` on a reference site.** A website states which addresses an
  automatic reader may fetch, and rulekit gave the operator no way to honour
  that: the nine checks held no path rule. An address under a listed prefix is
  now refused, and the rule applies to a redirect target as well, so a permitted
  address cannot redirect into a refused one. The README now also states the two
  things these checks do NOT do: nothing reads `robots.txt`, and
  `maxFetchesPerTurn` caps one question rather than a rate.
- **`extraSkills` adds a procedure without replacing the built-in ones.**
  `skills` REPLACES the set, so a caller who passed one procedure silently
  deleted the card and rulings procedures. The names gave no hint of the
  difference: `extraTools` adds and `skills` replaced.
- **`profile.attribution` is one sentence for the READER.** Every corpus carries
  a `NOTICE.txt`, and that file is written for the developer choosing a corpus:
  it names licences, directories, and what may be sold. The person asking
  whether a unit can block has no use for any of it, so an application that
  printed the file verbatim showed them the wrong document. A corpus author now
  writes the reader's sentence once. Nothing sends it to the model. `rulekit
  validate` prints a note when a corpus carries a notice and sets no
  attribution, and still reports the corpus valid. All five corpora carry one.
- **`createRulesAgent` warns about a tool on a declined subject.** The failure
  it names is silent and close to unfindable: the tool is registered, its
  description is right, `execute` works when called by hand, and the model never
  calls it once, because the instructions tell the assistant to decline that
  whole subject. The warning names the tool, the subject, and the procedure that
  grants it. It disappears once a procedure names the tool. It warns rather than
  throwing, and every word it matches is one a rules tool would not use, because
  a false warning costs a reader their trust in every later one.
- **The declined-subject warning fires while the agent is built.** It sat inside
  the lazy setup, so it printed after the server had started and its log had
  been read, in the middle of the first reader's request, once per process. The
  whole value of the warning is catching the mistake while somebody is wiring
  the tool up. A developer wired a tool, read a clean log, and shipped a tool
  the model never called.
- **A refused reference read reports itself as `rejected`.** The tool hands a
  refusal back as an ordinary result, so the runtime marked the step
  "completed", and a reader watching the trace saw a read that never happened
  reported as a finished one. `rejected` was declared in the type and set by
  nothing. The interface already counts and colours it.
- **`profile.attribution` is in the document that claims to hold every field.**
  So are `identity` and `extraGuidance`, which were in no document at all. A
  test now fails when any profile field is in no shipped document.
- **`@rulekitai/ui`'s README taught the fault its own release notes called
  fixed.** Its disclaimer example called `answerSource` with one argument, which
  mislabels every cached model answer as one no model wrote. The
  `rulekit-interface` skill did the same. A test now fails on a one-argument
  call in any document.
- **The `rulekit ask` miss message names the credential.** It said "the agent
  needs a model key" and never `AI_GATEWAY_API_KEY`, which left a reader knowing
  they needed a credential and not which name to set. The name comes from the
  resolver, so the message cannot drift from the code.
- **The README states the real test for a declined subject.** It said
  `check_stock` works because the question "reads as a card question", which is
  a judgement a reader cannot apply. The test is whether the assistant would
  decline the QUESTION from a reader holding no tool. The word list behind the
  warning is a separate, cruder net, and the README now says which words it
  deliberately omits and why.
- **`@rulekitai/rulekit` is a PEER dependency of `@rulekitai/ui`.** It was an
  ordinary dependency written `workspace:*`, which npm publishes as an exact
  version. An application on any other version of the rules package therefore
  received a SECOND copy of it inside the interface package, so the reader's
  answers were decoded by a different build from the one that produced them. A
  peer says the true thing: this interface reads the event stream that the rules
  package's server writes, so the two must be one copy.
- **`zod` is an optional peer dependency, pinned to version 4.** It was a plain
  dependency, so `import { z } from "zod"` in an application failed with
  `Cannot find package 'zod'`, and the Install section never mentioned it. The
  version matters as well: `defineTool` compares a schema against the copy here.

- **`defineTool` writes a tool with its input type inferred.** `RuleTool.execute`
  takes `never`, so one shared shape accepts every concrete input type. A plain
  object therefore gave `input` no type at all: every tool wrote its input shape
  by hand beside the Zod schema, and nothing compared the two. The 13 built-in
  tools and the 2 reference tools now use the factory, and 13 hand-written
  annotations are gone.
- **A custom tool that takes a built-in's name now throws.** The runtime builds
  its tool map with `Object.fromEntries`, which keeps the LAST entry for a
  repeated key. So a tool named `get_rule` passed through `extraTools` silently
  removed the built-in `get_rule`: 14 tools went in, 13 came out, and the agent
  lost its most-used lookup with no error. `assertUniqueToolNames` now names both
  tools. Set `replaces: true` to take a name on purpose.
- **`defineTool` checks the name** against `/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/`.
  That is Eve's pattern, and the AI SDK enforces nothing, so a bad name used to
  ship fine and stop `pnpm eve build` for somebody else.
- **A procedure states the tool it needs**, in `Skill.requiresTool`. The runtime
  held a hard-coded list of two names, which no caller could reach. A custom
  procedure can now say the same thing, and the Eve template reads the field
  rather than taking a second argument.
- **`docs/custom-tools.md` and the `rulekit-extend` skill** cover the whole step,
  including the extra file the Eve template needs for each tool.

- **`SqliteStore.open` refuses a database an older rulekit built**, and names
  the command that rebuilds it. `corpus.db` is a build artefact and is not in
  version control, so an upgraded package meets an old file often. The rulings
  tables are new, so the first question failed with `no such table: rulings`,
  which names neither the cause nor the cure, and it failed at run time rather
  than at start up. The database now carries a version, and the reader compares
  it. The JSON beside it needs no change.

### Changed

- **`RuleStore` gained two OPTIONAL methods**, `listRulings` and
  `searchRulings`. A custom store written against an earlier version still
  satisfies the interface, and a store that cannot answer with rulings never
  gets the rulings tool.
- **`SearchAllResult.rulings` is optional**, for the same reason.
- **`RuleKitConfig.disclaimer` takes a second argument**: the sites this answer
  read outside the rules data. An existing one-argument function still works.
- `RuleTool` gained an optional `describeResult`, which lets any tool add detail
  to its trace step. `extraTools` authors can use it too.
- **`rulekit eval` reads no reference site, and has no flag to enable one.** Its
  two checks compare an answer against the corpus, so it would grade a quotation
  from a website as a fabrication. A live page would also make one run score
  differently from the next.
- **`describeResult` receives the result `execute` returned**, rather than
  `unknown`. `defineTool` infers it, so a trace label is checked by the compiler.
  The README shows the four fields it may set, and says that a tool reading
  anything outside the corpus must set `source`.
- **The README prints the decline list.** The assistant is told to decline whole
  subjects, and registering a tool does not amend that list: a tool on a
  declined subject is never called, no error appears, and the tool records zero
  calls. The list was only in `src/agent/instructions/base.md`. A test fails if
  the printed copy drifts from the instructions.
- **The compiled database is version 3.** Rulings carry a folded copy of their
  own question, which is what answers a reader who types it. `SqliteStore.open`
  refuses an older file and names the command that rebuilds it.
- **The ten reference-site rules are numbered 1 to 10** in the code, the tests,
  and the README, and they are listed in the order they run.
- `CLAUDE.md` said seven packages were published. Two are.
- **The documents now follow ASD-STE100 Simplified Technical English.** Every
  Markdown file carries one idea per sentence, the active voice, and no idiom.
  The pass also corrected wrong facts: three files said this project needs Node
  22, and `package.json` requires 22.5; `SECURITY.md` said the assistant opens
  no network connection of its own, which `fetch_reference` made untrue; and
  `data/README.md` said both rulings files mark their rulings unofficial, while
  `data/demo` marks 7 of 9 official.


### Fixed

- **`source_url` reaches the screen.** A ruling that carries a publisher and an
  address printed the publisher alone, so a corpus under a licence such as
  CC BY-SA could not meet its own terms without putting markup inside a field
  called `source_name`. The name is now a link.
- **A cached answer that a model wrote no longer reads as "no AI wrote this".**
  The server kept the origin correctly across the cache, and the interface lost
  it: `ChatMessage` carried no `source`, and the non-streaming path read
  `servedBy` where the streaming path read `source`. A cache hit always takes
  the non-streaming path, so every repeated question was mislabelled. The
  disclaimer callback now receives the origin as a third argument.
- **`rulekit validate` refuses two rulings that share an id.** The id is what a
  citation carries, so a reader following one to a corpus with two such rows
  cannot be told which one answered.
- **`rulekit validate` refuses a ruling whose card name disagrees with its card
  id.** The id resolved, so the link check passed, and the rendered answer
  prints the NAME. A ruling that names the wrong card is worse than no ruling.
- **`rulekit validate` names the ruling, not the array index.** It reported
  `[item 0]`, which is a counting exercise in a file of four hundred rows, while
  the id sat in the row. It also said "1 link point at something"; it now says
  "points".
- **A reference site whose `host` holds a path or a space is refused.** The type
  said "no scheme and no path" and nothing enforced it, so
  `host: "example.com/cards"` matched every path on the host. A person who
  writes that wants a restriction the field cannot give.
- **`rulekit ask` names five shapes of question, with an example of each.** It
  named two, and never mentioned the banned list or rulings. The reader most
  likely to meet that message is the one who just wrote `rulings.json`. A test
  now runs every example the message prints and fails if one does not answer.
- **Fifteen of the forty-one command tests ran invisibly.** The test helper
  replaced `process.stdout.write` to capture what a command printed, and the
  test runner reports its own results through that same function, so the runner
  lines were swallowed. The summary printed "tests 26 / pass 26 / fail 0", and a
  deliberately broken test still printed "fail 0". Only the exit code stayed
  honest. The command now writes through an `output` object a test replaces.

### Breaking

- **`createRulesAgent(...).instructions` is now a function that returns a
  promise**, and `.tools` returns the reference tools as well. Both depend on
  reading which collections the corpus holds, which decides whether the rulings
  procedure is included, and that read is asynchronous. Nothing in this
  repository consumed either one.

## [0.4.0] - 2026-08-11

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
