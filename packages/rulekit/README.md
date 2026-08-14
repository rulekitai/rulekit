# @rulekitai/rulekit

A grounded rules assistant: the corpus, the agent, the answer pipeline, the HTTP
handler, and the `rulekit` command.

It answers a question from your own rulebook, quotes that rulebook, and gives
the source of each claim. When the corpus holds no answer, it says so.

Part of [rulekit](https://github.com/rulekitai/rulekit).

## Install

```bash
pnpm add @rulekitai/rulekit
pnpm add ai
pnpm add zod@^4      # only if you write a tool of your own
```

The free stages read rows to answer a rule number, a legality question, a
rulings lookup, a ruling's own question, and a keyword definition. They cost no
model call. The agent answers every other question, and the agent needs `ai`.
Leave `ai` out only if you serve rule lookups alone.

**Install `zod` yourself before you write a tool.** Zod is the library that
describes what a tool takes as input. This package holds its own copy, and a
copy inside a package is not one your application can import, so
`import { z } from "zod"` fails with `Cannot find package 'zod'` until you add
it. **It must be zod 4.** `defineTool` compares your schema against the version
here, and a schema written with another major version is a type error that
points at your tool rather than at the mismatch.

## Use

```bash
npx rulekit init my-game       # copy a corpus to start from
npx rulekit validate my-game   # names every problem
npx rulekit build my-game      # writes my-game/corpus.db
npx rulekit ask my-game "what is Swift" --json   # one object, for a script
npx rulekit --version
```

Four corpora travel inside this package: `demo` (the default), `chess`,
`texas-holdem`, and `estate-line`. Name one with `--corpus`:

```bash
npx rulekit init my-game --corpus chess
```

All four carry a CC0 1.0 dedication, so you may copy one and sell what you build
on it. The Riftbound corpus is not here. Riot Games owns that data and permits
non-commercial use only, so it stays in
[the repository](https://github.com/rulekitai/rulekit/tree/main/data/riftbound).

```ts
import { SqliteStore } from "@rulekitai/rulekit/corpus/sqlite-store"
import { parseProfile } from "@rulekitai/rulekit/agent/profile"
import { createRulesAgent } from "@rulekitai/rulekit/agent/runtime"
import { createPipeline } from "@rulekitai/rulekit/pipeline/pipeline"
import { staticAnswersStage } from "@rulekitai/rulekit/pipeline/stages/static"
import { glossaryStage } from "@rulekitai/rulekit/pipeline/stages/glossary"
import { createAskHandler } from "@rulekitai/rulekit/server/handler"

const store = SqliteStore.open("my-game/corpus.db")
const profile = parseProfile(myProfileJson)

export const POST = createAskHandler({
  pipeline: createPipeline({
    store,
    profile,
    stages: [staticAnswersStage(store), glossaryStage(store)],
  }),
  agent: createRulesAgent({ store, profile, model: "anthropic/claude-sonnet-5" }),
})
```

`createAskHandler` returns a plain function from `Request` to `Response`, so the
same export works in Next.js, Hono, Bun, Deno, and a Cloudflare Worker. Only a
question that every free stage misses reaches the agent.

## Rulings

A rule is the published text. An erratum changes that text. A **ruling** reads
the unchanged text and says what it means in one case. A ruling therefore
carries a question and an answer, and the other two carry statements.

Put your rulings in `rulings.json`, beside the other corpus files:

```json
{ "schemaVersion": 2,
  "items": [
    { "id": "rul-001",
      "kind": "card",
      "question": "Does Guard force an attack to be blocked by that unit?",
      "answer": "No. Guard makes the unit eligible to block, and the defender still chooses.",
      "cards": [{ "id": "pk-001", "name": "Stonewall Sentry" }],
      "rule_numbers": ["300.2", "800.1"],
      "topic": "blocking",
      "source_name": "Paper Kingdoms Rules Team",
      "is_official": true,
      "effective_date": "2026-03-01" }
  ] }
```

`kind` is `card` for a question about named pieces, `general` for a mechanic or
a timing, or `policy` for running an event. A `card` ruling must name one card
or more.

- **`rulings.json` is the one corpus file you may leave out.** Every other
  missing file fails the load.
- **`is_official` is false unless you set it.** Most rulings that anybody can
  collect are somebody's careful reading, and not the publisher's word.
- **`rulekit validate` resolves `rule_numbers` and every `cards[].id`.** That
  turns a ruling from an assertion into something a reader can check.

Once the file holds a row, two things switch on by themselves. A free stage
answers from these rows with no model call, and the agent gains a `list_rulings`
tool. Both stay off while the file is absent or empty.

**Two shapes of question answer free, and no other shape does.**

| You ask | What answers |
|---|---|
| `rulings for Stonewall Sentry` | The free stage, in a few milliseconds |
| `Stonewall Sentry faq` | The free stage |
| The `question` field of a ruling, word for word | The free stage |
| `Can Stonewall Sentry block two attackers?` | The agent, which costs a model call |

The first two are a **lookup**: the words "rulings" or "faq", plus a piece this
corpus knows. The third is an **exact match** on the question a ruling itself
asks, folded for case, spacing, accents, and a final question mark. Nothing
else matches, and that is on purpose: a ruling that merely resembles the
question is the wrong answer, and presenting it as the right one is worse than
paying for a model call.

Write the `question` field as the reader would type it. It is the phrasing they
read on the publisher's page, and it is the one phrasing that costs nothing.

[The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
holds every field.

## Reference sites

No corpus holds every ruling. When yours holds no answer, you can let the agent
read websites that **you** name.

**This package ships no reference site, recommends none, and endorses none.**
When you name a site, you accept its terms of use and you control how often you
read it.

```ts
import { createRulesAgent } from "@rulekitai/rulekit/agent/runtime"
import { MemoryCache } from "@rulekitai/rulekit/pipeline/cache"

const agent = createRulesAgent({
  store,
  profile,
  model: "anthropic/claude-sonnet-5",
  references: {
    sites: [
      {
        name: "Example FAQ",             // what an answer calls it
        host: "faq.example.com",         // this host and its subdomains ONLY
        describes: "Community rulings for Example, with rule citations.",
        official: false,                 // false unless the publisher writes it
        cardPath: "/cards/{slug}",       // optional address hint
        disallowPaths: ["/api/"],        // addresses under these are refused
      },
    ],
    cache: new MemoryCache(),            // without one, every question refetches
    maxFetchesPerTurn: 3,
    userAgent: "my-app (+https://example.com/contact)",
  },
})
```

An empty `sites` list adds no tool and makes no network call. The option is safe
to leave in place before you have chosen a site.

**Pass the sites here. Do not pass them through `extraTools`.** This option adds
the two tools AND the instruction block that makes the model label an outside
claim as one. The tools without that block produce an answer that cites a
website as though it were your rules. Nothing after that point can separate the
two.

The code checks every address that the model chooses. Ten rules, each with its
own test:

1. `https` only.
2. The host must be one you list, or a subdomain of it.
3. A path under `disallowPaths` is refused.
4. The code checks a redirect against the list, then follows it at most once,
   and the path rule applies to where it lands.
5. It sends no credentials.
6. A timeout, so one slow site cannot hold a question open.
7. The content type must be readable text.
8. A byte cap, applied while reading rather than after.
9. A fetch count for each question.
10. A cache by address.

**Two things these rules do NOT do.** Neither is a gap you can ignore, because
the site's own terms may ask for both.

- **Nothing reads `robots.txt`.** That file is where a website states which
  addresses an automatic reader may fetch. Read it yourself, then write what it
  forbids into `disallowPaths`. Put the date you read it in a comment, because
  the site may change it.
- **`maxFetchesPerTurn` is not a rate limit.** It caps one question. Ten readers
  asking three questions each still make thirty fetches. Pass your own
  `fetchImpl` when you need a limit across questions; it receives every fetch
  this package makes.

A reader learns twice that the answer read a site, and neither mark comes from
the model's text: the tool marks its own trace step, and
[`@rulekitai/ui`](https://www.npmjs.com/package/@rulekitai/ui) renders that mark
and hands your disclaimer the list of sites.

`rulekit eval` reads no reference site and offers no flag to add one. Its checks
compare an answer against the corpus, so a quotation from a website would be
graded a fabrication.

[Reference sites](https://github.com/rulekitai/rulekit/blob/main/docs/reference-sites.md)
covers the whole step.

## Crediting the rules you use

Most rules data belongs to somebody. Every corpus here carries a `NOTICE.txt`
that states the terms, and that file is written **for you**, the person choosing
a corpus: it names licences, directories, and what you may sell.

The person asking whether a unit can block needs a different sentence, and a
shorter one. Write it once, in `profile.json`:

```json
{
  "attribution": {
    "text": "Riot Games, Inc. owns the Riftbound rules data. This is an unofficial community project, and Riot Games does not endorse it.",
    "url": "https://www.riotgames.com/en/legal",
    "official": false
  }
}
```

Then show it under the conversation:

```tsx
<RuleKitProvider legalNote={profile.attribution?.text}>
```

Nothing sends this to the model. It is a credit, not an instruction.
`rulekit validate` prints a note when a corpus carries a `NOTICE.txt` and its
profile sets no `attribution`, and still reports the corpus valid.

**A ruling credits itself.** Set `source_name` and `source_url` on a row and the
answer prints the name as a link, which is what a licence such as CC BY-SA asks
for. Use `attribution` for the corpus as a whole, and the ruling fields for a
row that came from somewhere else.

## Custom tools

The 13 built-in tools read the corpus. Add one when the answer needs data only
your application holds.

```ts
import { defineTool } from "@rulekitai/rulekit/agent/tools"
import { z } from "zod"

const checkStock = defineTool({
  name: "check_stock",
  description: "Read how many copies of a card this shop holds.",
  inputSchema: z.object({ card_name: z.string() }),
  execute: async (input) => myShop.find(input.card_name),   // `input` is typed from the schema
  // What the reader sees in the trace above the answer. Optional.
  // `result` is typed from `execute`, so the compiler checks this line.
  describeResult: (result) => ({
    label: `Checked the shop shelf — ${result.length} in stock`,
    kind: "looked-up",
  }),
})

createRulesAgent({ store, profile, model, extraTools: [checkStock] })
```

**Use `defineTool`, and not a plain object.** `RuleTool.execute` takes `never`,
so one shared shape accepts every concrete input type. A plain object therefore
gives `input` no type, you write the shape by hand, and nothing compares it
against the schema beside it.

Three rules it enforces:

1. **A name starts with a letter**, then holds letters, digits, underscores, and
   hyphens, up to 64 characters. Eve names a tool after its file, and rejects
   the rest.
2. **A repeated name throws.** A tool named `get_rule` used to remove the
   built-in `get_rule` in silence. Set `replaces: true` to take a built-in's
   name on purpose.
3. **A procedure states the tool it needs.** Set `requiresTool` on your own
   procedure, and the agent drops it when that tool is absent.

### What `describeResult` returns

It returns some of the fields of one trace step — the line a reader sees above
the answer while the assistant works. You may set four:

| Field | What it does |
|---|---|
| `label` | The sentence the reader sees. Write it for them, not for you. |
| `kind` | `searched`, `looked-up`, `read`, or `ran`. It groups the step. |
| `status` | `running`, `completed`, `failed`, or `rejected`. |
| `source` | **The site this step read, outside the corpus.** `{ name, url, official }` |

Return nothing and the step stays as it was.

**Set `source` whenever your tool reads something that is not the corpus.** It
is how a claim is marked as coming from elsewhere. `@rulekitai/ui` collects
every `source` on an answer and hands the list to your disclaimer, so the reader
learns the provenance from the machinery and never from a sentence the model
chose to write. A tool that reads a supplier's website and leaves `source`
unset produces an answer that looks like it came from your rules.

### A tool alone is not permission to use it

**Registering a tool does not amend the instructions.** The assistant is told to
decline whole subjects, and a tool whose subject is on that list is never
called. No error appears. The model simply answers that the subject is outside
what it covers, and your tool sits there with zero calls.

This is the list, and it is the most behaviour-determining text in the package:

> **Decline these**, even when you could guess:
>
> - Strategy and deck construction, including the best deck, a ranking, a
>   comparison of two decks, whether to include a card, and any rating.
> - Shops, events, dates, locations, and schedules.
> - Real people, including players, staff, streamers, and anybody named.
> - Prices, market value, trading, investment, and grading.
> - Story and background, unless the question is about a defined term.
> - Unreleased content, leaks, and future changes the tools do not return.
> - Accounts, orders, refunds, and support.
> - Invented cards, and cards changed by a house rule.
> - Anything not about this game, including other games, general conversation,
>   programming, translation, medical, legal, or financial questions.

`check_stock` above works because "how many copies are in stock" reads as a card
question. A `find_events` tool does not, because events are on the list. Read
the list before you write a tool, and check whether your subject sits on it.

`createRulesAgent` warns when it recognises a declined subject in a tool's name
or description, and stops warning once a procedure names that tool. The warning
is a word search, so it can miss one. Read the list yourself as well.

**Write a procedure to grant the subject.** A procedure is a short document the
assistant reads when a question matches its description. It is what tells the
model that this subject is now in scope and which tool answers it:

```ts
import { createRulesAgent } from "@rulekitai/rulekit/agent/runtime"

const shopEvents = {
  name: "shop_events",
  description: "Use for a question about where or when to play at a shop.",
  requiresTool: "find_events",             // dropped if the tool is absent
  body: "# Shop events\n\nThis assistant answers shop event questions. "
      + "Call `find_events` with the city, then list what it returns.",
}

createRulesAgent({
  store,
  profile,
  model,
  extraTools: [findEvents],
  extraSkills: [shopEvents],               // ADDS to the built-in procedures
})
```

**Use `extraSkills`, not `skills`.** `extraSkills` adds to the built-in
procedures. `skills` REPLACES them, so passing your one procedure there deletes
the card and rulings procedures and the assistant quietly gets worse at its main
job. Pass `skills` only when you mean to write the whole set.

[Custom tools](https://github.com/rulekitai/rulekit/blob/main/docs/custom-tools.md)
covers the whole step, including the extra file the Eve template needs.

## The subpaths

| Prefix | What it holds |
|---|---|
| `@rulekitai/rulekit/corpus/*` | The JSON schema, the SQLite builder, and one read interface |
| `@rulekitai/rulekit/agent/*` | Tools, instructions, procedures, and an AI SDK runtime |
| `@rulekitai/rulekit/pipeline/*` | The stages, the cache, the permission check, and credentials |
| `@rulekitai/rulekit/server/*` | The HTTP handler |
| `@rulekitai/rulekit/sqlite-warning` | Hides Node's SQLite notice, described below |

**There is no root import.** `import ... from "@rulekitai/rulekit"` throws a
message that names the subpaths instead, because you take every part on its own:
the corpus store without the agent, or the agent without the command.

Add [`@rulekitai/ui`](https://www.npmjs.com/package/@rulekitai/ui) for React
hooks and chat components.

## The SQLite notice

The corpus store reads `node:sqlite`, which ships inside Node and is still
marked experimental. Node therefore prints this before your server starts:

```
ExperimentalWarning: SQLite is an experimental feature and might change at any time
```

Nothing is wrong. The `rulekit` command hides that one warning by itself. A
server of your own decides for itself, in one line:

```ts
import { hideSqliteExperimentalWarning } from "@rulekitai/rulekit/sqlite-warning"

hideSqliteExperimentalWarning() // hides that one notice, prints every other warning
```

## Documentation

**Every document below travels inside this package**, under `docs/`. Read a
local copy with no network:

```bash
cat node_modules/@rulekitai/rulekit/docs/custom-tools.md
```

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md):
  every field of every corpus file, including rulings
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Reference sites](https://github.com/rulekitai/rulekit/blob/main/docs/reference-sites.md):
  reading a website when the corpus holds no answer
- [Custom tools](https://github.com/rulekitai/rulekit/blob/main/docs/custom-tools.md):
  a tool of your own, and the procedure that lets the model use it
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)
- [Verifying answers](https://github.com/rulekitai/rulekit/blob/main/docs/verifying-answers.md)
- [Design decisions](https://github.com/rulekitai/rulekit/blob/main/docs/design-decisions.md)
- [What changed in each release](https://github.com/rulekitai/rulekit/blob/main/CHANGELOG.md),
  also shipped as `CHANGELOG.md`

The eight skills that teach an agent to use this package ship too, under
`skills/`. Point your assistant at that directory.

## Licence

Apache 2.0. See the `LICENSE` file beside this one. Each corpus carries its own
terms, and the four inside this package carry a CC0 1.0 dedication.
