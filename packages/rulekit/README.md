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
```

The free stages read rows to answer a rule number, a legality question, a
rulings lookup, and a keyword definition. They cost no model call. The agent
answers every other question, and the agent needs `ai`. Leave `ai` out only if
you serve rule lookups alone.

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

Once the file holds a row, two things switch on by themselves.
`npx rulekit ask my-game "rulings for <a piece>"` answers from these rows with
no model call, and the agent gains a `list_rulings` tool. Both stay off while
the file is absent or empty.

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

The code checks every address that the model chooses. Nine rules, each with its
own test:

1. `https` only.
2. The host must be one you list, or a subdomain of it.
3. The code checks a redirect against the list, then follows it at most once.
4. It sends no credentials.
5. A timeout, so one slow site cannot hold a question open.
6. A byte cap, applied while reading rather than after.
7. The content type must be readable text.
8. A fetch count for each question.
9. A cache by address.

A reader learns twice that the answer read a site, and neither mark comes from
the model's text: the tool marks its own trace step, and
[`@rulekitai/ui`](https://www.npmjs.com/package/@rulekitai/ui) renders that mark
and hands your disclaimer the list of sites.

`rulekit eval` reads no reference site and offers no flag to add one. Its checks
compare an answer against the corpus, so a quotation from a website would be
graded a fabrication.

[Reference sites](https://github.com/rulekitai/rulekit/blob/main/docs/reference-sites.md)
covers the whole step.

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

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md):
  every field of every corpus file, including rulings
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Reference sites](https://github.com/rulekitai/rulekit/blob/main/docs/reference-sites.md):
  reading a website when the corpus holds no answer
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)
- [Verifying answers](https://github.com/rulekitai/rulekit/blob/main/docs/verifying-answers.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one. Each corpus carries its own
terms, and the four inside this package carry a CC0 1.0 dedication.
