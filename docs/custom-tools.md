# Custom tools and custom procedures

rulekit ships 13 tools that read the corpus. Add your own when the answer needs
something the corpus does not hold: a price, a stock level, a player's
collection, or a service you already run.

A tool is plain data: a name, a description, a Zod schema, and an async
function. There is no class to extend and no registry to join. You write one
through `defineTool`, which types the function from the schema.

## Decide first

A tool costs a step in every turn that calls it, and its description costs
context in every turn. Two questions come before the code.

**Does the corpus already hold this?** A ruling belongs in `rulings.json`, where
it answers in milliseconds with no model call. See
[the corpus format](corpus-format.md). A tool that reads the corpus repeats work
the 13 built-in tools already do.

**Does a website hold it?** Then name the site instead. See
[reference sites](reference-sites.md). That path already marks the claim as a
second source, and a tool of your own does not.

Write a tool for data only your application holds.

## Write the tool

```ts
import { defineTool } from "@rulekitai/rulekit/agent/tools"
import { z } from "zod"

const checkStock = defineTool({
  name: "check_stock",
  description: "Read how many copies of a card this shop holds. Use it when a reader asks to buy one.",
  inputSchema: z.object({
    card_name: z.string().describe("The card's printed name"),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  execute: async (input) => {
    // `input` is typed from the schema above. No annotation, and no cast.
    const rows = await myShop.find(input.card_name, input.limit ?? 5)
    return { rows, count: rows.length }
  },
})

const agent = createRulesAgent({ store, profile, model, extraTools: [checkStock] })
```

**Use `defineTool`, and not a plain object.** `RuleTool.execute` takes `never`,
so that every concrete input type satisfies one shared shape. A plain object
therefore gets no inference: you write the input type by hand, and nothing
compares it against the schema beside it. The two drift apart in silence.
`defineTool` infers `input` from `inputSchema`, so the compiler checks the body.

### The name

A name starts with a letter. It then holds letters, digits, underscores, and
hyphens, up to 64 characters. `defineTool` throws for anything else.

That pattern is Eve's, and the AI SDK enforces nothing. A name that fails it
works on the AI SDK runtime and stops `pnpm eve build` for anybody who runs the
Eve template, so `defineTool` refuses it at the source.

### The description

The model reads the description to choose the tool. State what the tool returns,
and when to call it. A description that names no trigger is a tool the model
never calls.

## Two tools of one name

**A repeated name throws, and names the tool.** Before this guard, a tool named
`get_rule` silently removed the built-in `get_rule`: 14 tools went in, 13 came
out, and the agent lost its most-used lookup with no error.

Rename your tool, or take the name on purpose:

```ts
defineTool({
  name: "search_all",
  replaces: true, // I mean to replace the built-in search
  ...
})
```

A tool that sets `replaces` wins, and the tool it replaced never reaches the
model.

## Mark a step in the trace

The trace is the list of tool calls a reader watches. A tool that did something
a reader must weigh says so through `describeResult`:

```ts
describeResult: (result) => ({
  label: "Read the shop stock",
  kind: "read",
})
```

`@rulekitai/ui` renders the label. The `source` field marks a claim from outside
the corpus, and [reference sites](reference-sites.md) covers that.

**Eve discards `describeResult`.** The Eve adapter passes `description`,
`inputSchema`, and `execute`, and nothing else. A tool that marks its trace step
works on the AI SDK runtime and does nothing on Eve.

## Write a procedure for it

A procedure is a page of instructions the model reads when it applies. Give one
to a tool whose correct use is not obvious from its description.

```ts
const shopLookup = {
  name: "shop_lookup",
  description: "Use when the reader asks to buy a card, or asks what a card costs.",
  body: "# Reading the shop\n\nCall `check_stock` with the printed name...",
  requiresTool: "check_stock",
}

createRulesAgent({ store, profile, model, extraTools: [checkStock], skills: [...builtinSkills(), shopLookup] })
```

**Set `requiresTool`.** The agent drops a procedure whose tool it does not
offer. Without that, a corpus that cannot serve your tool still hands the model
a page telling it to call one, and the model calls a tool that is not there.

The two shipped procedures do the same: `card_lookup` states
`requiresTool: search_cards`, and `rulings_lookup` states
`requiresTool: list_rulings`.

**Passing `skills` replaces the whole list.** Spread `builtinSkills()` to keep
the shipped procedures.

## The Eve step

Skip this unless you run the Eve template.

Eve names a tool after its file, and reads the directory rather than a list. A
custom tool therefore needs a file:

```ts
// templates/eve-agent/agent/tools/check_stock.ts
import { eveTool } from "../../lib/rules-tools.ts"

export default eveTool("check_stock")
```

Without that file the tool exists on the AI SDK runtime and is absent on Eve.
The directory holds 22 files today: 13 map to rulekit tools, and 9 switch off an
Eve built-in.

A procedure needs the same treatment, through `eveSkill("shop_lookup")`, which
reads `requiresTool` for you.

## Failures, and the cause of each

| What you see | Cause |
|---|---|
| `Two tools are named "X"` | Your tool takes a built-in's name. Rename it, or set `replaces: true` |
| `"X" is not a usable tool name` | The name breaks the pattern. Start with a letter |
| `input` is typed `never` | You wrote a plain object. Use `defineTool` |
| The model never calls your tool | The description names no trigger |
| The procedure names a tool that is absent | Set `requiresTool` on the procedure |
| The tool works on the AI SDK and not on Eve | Add the file under `agent/tools/` |
| The shipped procedures disappeared | You passed `skills` without `builtinSkills()` |

## Read next

- [The corpus format](corpus-format.md): hold the data instead
- [Reference sites](reference-sites.md): read a website instead
- [Architecture](architecture.md): where a tool sits in one turn
