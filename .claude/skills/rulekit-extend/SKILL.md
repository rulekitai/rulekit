---
name: rulekit-extend
description: Give a rulekit agent a tool or a procedure of your own. Use when the user wants the assistant to read data outside the corpus, or names `extraTools`, `defineTool`, or a custom tool.
---

# Add a tool of your own

rulekit ships 13 tools that read the corpus. Add one when the answer needs data
only the application holds: a price, a stock level, a player's collection.

## Step 1: check that a tool is the right answer

Two cheaper paths come first.

| The data | Use | Skill |
|---|---|---|
| A ruling you may copy | `rulings.json` in the corpus | `rulekit-corpus` |
| A page on somebody's website | A reference site | `rulekit-references` |
| Data only this application holds | A tool | This one |

The corpus answers in milliseconds with no model call. A reference site already
marks its claim as a second source. A tool does neither, so reach for it last.

**Criterion:** you can name the data, and no corpus file and no website holds it.

## Step 2: write the tool

```ts
import { defineTool } from "@rulekitai/rulekit/agent/tools"
import { z } from "zod"

const checkStock = defineTool({
  name: "check_stock",
  description: "Read how many copies of a card this shop holds. Use it when a reader asks to buy one.",
  inputSchema: z.object({ card_name: z.string(), limit: z.number().int().optional() }),
  execute: async (input) => {
    const rows = await myShop.find(input.card_name, input.limit ?? 5)
    return { rows, count: rows.length }
  },
})

createRulesAgent({ store, profile, model, extraTools: [checkStock] })
```

**Use `defineTool`, and not a plain object.** `RuleTool.execute` takes `never`,
so a plain object gives `input` no type. You then write the input shape by hand,
nothing compares it against the schema, and the two drift apart in silence.
`defineTool` infers `input` from `inputSchema`.

A name starts with a letter, then holds letters, digits, underscores, and
hyphens, up to 64 characters. `defineTool` throws for anything else, because Eve
names a tool after its file and rejects the rest.

**Criterion:** `createRulesAgent(...).tools()` lists your tool, and
`pnpm check-types` passes with no annotation on `execute`.

## Step 3: keep the name to yourself

**A repeated name throws.** A tool named `get_rule` used to remove the built-in
`get_rule` in silence: 14 tools went in, 13 came out, and the agent lost its
most-used lookup with no error.

Rename your tool. To take a built-in's name on purpose, set `replaces: true`,
and your tool wins.

## Step 4: write a procedure, when the tool needs one

A procedure is a page the model reads when it applies.

```ts
const shopLookup = {
  name: "shop_lookup",
  description: "Use when the reader asks to buy a card, or asks what a card costs.",
  body: "# Reading the shop\n\nCall `check_stock` with the printed name...",
  requiresTool: "check_stock",
}

createRulesAgent({ ..., skills: [...builtinSkills(), shopLookup] })
```

**Set `requiresTool`.** The agent drops a procedure whose tool it does not
offer. Without it, the model reads a page telling it to call a tool that is not
there.

**Spread `builtinSkills()`.** Passing `skills` replaces the whole list, so the
shipped procedures disappear when you leave them out.

## Step 5: add the Eve file, when you run the Eve template

Eve names a tool after its file, and reads the directory rather than a list.

```ts
// templates/eve-agent/agent/tools/check_stock.ts
import { eveTool } from "../../lib/rules-tools.ts"

export default eveTool("check_stock")
```

Without that file the tool works on the AI SDK runtime and is absent on Eve. A
procedure needs `eveSkill("shop_lookup")` in `agent/skills/`.

**Eve discards `describeResult`.** A tool that marks its trace step works on the
AI SDK runtime and does nothing on Eve.

## When something fails

| What you see | Cause |
|---|---|
| `Two tools are named "X"` | Your tool takes a built-in's name. Rename it, or set `replaces: true` |
| `"X" is not a usable tool name` | The name breaks the pattern. Start with a letter |
| `input` is typed `never` | You wrote a plain object. Use `defineTool` |
| The model never calls the tool | The description names no trigger |
| The shipped procedures disappeared | You passed `skills` without `builtinSkills()` |
| It works on the AI SDK and not on Eve | Add the file under `agent/tools/` |

## Completion criterion

All four are true:

- `createRulesAgent(...).tools()` lists your tool, and throws for a repeated
  name.
- `pnpm check-types` passes, and `execute` carries no hand-written input type.
- A question that needs your data reaches your tool, and the trace names it.
- With the Eve template, `pnpm eve build` succeeds and offers the same tools.

## Next

- Hold the data in the corpus instead: `rulekit-corpus`
- Read a website instead: `rulekit-references`
- The whole step, in depth:
  <https://github.com/rulekitai/rulekit/blob/main/docs/custom-tools.md>
