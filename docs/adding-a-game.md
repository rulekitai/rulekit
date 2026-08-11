# Adding a game

Four steps. You write JSON in two of them.

```bash
pnpm rulekit init my-game        # copy the complete example
# ... replace its contents with your own ...
pnpm rulekit validate my-game    # this names every problem
pnpm rulekit build my-game       # this compiles my-game/corpus.db
pnpm rulekit ask my-game "what is <a keyword in your game>"
```

The last command needs no model and no key, so you can judge a corpus before you
connect anything. It runs the free stages only, and it answers a rule number and
a keyword. For a question of a different type it reports that it cannot answer.
That report tells you nothing about the corpus, because the agent answers those
questions.

## 1. The corpus

The file `docs/corpus-format.md` states every field. The directory `data/demo/`
is a complete example of all of them.

You can start with `rules.json` alone. The terms, the cards, the errata, and the
banned list can all be empty lists, and the assistant works without them. It
answers fewer types of question.

**Put the pieces that a player can name into `cards.json`.** The name comes from
trading card games, and the file accepts more than trading cards. Chess puts its
six pieces there, and poker puts the 52 cards of the pack there.

## 2. The profile

The file `profile.json` holds the facts about your game that the instructions
cannot know. The grounding rules are part of the code: give a source for
everything, quote in place of a summary, and invent nothing. A profile adds to
those rules, and it cannot remove them.

This is the shortest profile that works:

```json
{ "game": { "name": "My Game" }, "cards": { "enabled": false } }
```

Then make it more exact.

### The words of your game

```json
"vocabulary": [
  { "use": "Resolve", "insteadOf": ["toughness"], "means": "It names how much damage a unit survives." }
]
```

Write this section. A model that learned other games uses the words of those
games. A player who reads the rules of their own game in the words of a
different game stops trusting the answer.

### Cards

```json
"cards": {
  "enabled": true,
  "noun": "piece",
  "linkScheme": "card",
  "maxInlineImages": 3,
  "textFields": [
    { "field": "card_text", "describes": "the card's own text box" },
    { "field": "effect_text", "describes": "the box an equipped holder gains" }
  ]
}
```

**"Cards" means the pieces of your game that a player can name.** Chess lists its
six pieces. Poker lists the 52 cards of the pack. A property game lists its
deeds.

**Set `noun` to the word that your game uses for one of them.** The code builds
every sentence about the card tools from this word. A chess assistant therefore
gets a tool to "find Chess pieces", and it never gets a tool for "Chess cards".
The default is "card". Also set `nounPlural` when an added "s" gives the wrong
word.

Set `enabled` to false only when your game has no pieces that a player can name.
The code then creates no card tools. A tool that can answer only "nothing found"
costs one turn, and it teaches the model to distrust the result.

**List every text field that your cards use.** This is the most valuable line in
a profile. Without it, a model reads the first field, finds an equipment line,
and reports that the card does nothing.

The key `field` names a key of the `text` map of a card, so these are the names
that your own game uses.

**Describe each printed value whose name does not explain it**, in `statFields`:

```json
"statFields": [
  { "field": "price", "describes": "What the Bank charges, in Crowns." },
  { "field": "rank_value", "describes": "From 2 for a Two to 14 for an Ace. Higher beats lower." }
]
```

List only those values. The name `rarity` explains itself, and each described
value costs prompt text for every card question.

### Symbols

```json
"tokens": {
  "syntax": "[Fury] or [Shield 2]",
  "groups": [ { "label": "Runes", "examples": ["[Fury]", "[Calm]"] } ]
}
```

Omit this section for a game with no symbols, and the answers then use plain
words. A rulebook also uses square brackets in ordinary sentences, so the code
rewrites nothing until you ask for it.

### Scope

```json
"scope": {
  "answer": ["Rule text and rule numbers.", "Whether a card may be played."],
  "refuse": ["Anything about the digital client."]
}
```

The refusals that apply to every game are part of the code: strategy, prices,
real people, and questions about a different subject. This section adds to them.

## 3. Connect it

The example application reads one variable:

```bash
RULEKIT_CORPUS=my-game pnpm dev
```

In your own application, the connection is a few lines:

```ts
import { parseProfile } from "@rulekitai/rulekit/agent/profile"
import { createRulesAgent } from "@rulekitai/rulekit/agent/runtime"
import { SqliteStore } from "@rulekitai/rulekit/corpus/sqlite-store"
import { createPipeline } from "@rulekitai/rulekit/pipeline/pipeline"
import { exactCacheStage } from "@rulekitai/rulekit/pipeline/stages/cache"
import { glossaryStage } from "@rulekitai/rulekit/pipeline/stages/glossary"
import { staticAnswersStage } from "@rulekitai/rulekit/pipeline/stages/static"
import { createAskHandler } from "@rulekitai/rulekit/server/handler"

const store = SqliteStore.open("my-game/corpus.db")
const profile = parseProfile(myProfileJson)

export const POST = createAskHandler({
  pipeline: createPipeline({
    store,
    profile,
    stages: [exactCacheStage(), staticAnswersStage(store), glossaryStage(store)],
  }),
  agent: createRulesAgent({ store, profile, model: "anthropic/claude-sonnet-5" }),
})
```

The function `createAskHandler` returns a plain function from `Request` to
`Response`. The same export therefore works in Next.js, Hono, Bun, Deno, and a
Cloudflare Worker.

## 4. Judge it

Ask the questions that your players ask. Watch for three failures:

**The assistant invents an answer.** The corpus has a gap, and the model filled
it. Add the data. If this continues for questions that the corpus does cover,
your `content` fields are probably too short to answer from.

**The assistant quotes the wrong rule.** The usual cause is an unset `rule_type`
or `is_deprecated` field. Headings and superseded text then fill the search
results.

**The assistant reads a card incorrectly.** The usual cause is a missing entry in
`cards.textFields`.

## Adjust the free stages

You choose the order of the stages:

```ts
stages: [exactCacheStage(), staticAnswersStage(store), glossaryStage(store)]
```

### Clear every cached answer at once

An answer stays in the cache for a week. When you change the corpus, the answers
already cached still quote the old rules. Bump the cache version to put all of
them out of reach in one step:

```ts
createPipeline({ store, profile, stages, cacheVersion: "2" })
```

The version is part of every cache key, so nothing has to be enumerated and
deleted. Set it in this one place. The reading stage and every writer take it
from here, and a version set anywhere else would be read at the new number and
written at the old one, which empties the cache for good rather than once.

You can configure the patterns of the static stage. Different games number their
rules in different ways, and they ask about legality with different words:

```ts
staticAnswersStage(store, {
  classify: {
    ruleNumberPattern: String.raw`\d{1,3}(?:\.\d{1,3})*`,
    legalityWords: ["banned", "legal", "allowed", "tournament legal"],
    formatWords: ["standard", "open", "casual"],
  },
})
```

Each word list is closed on purpose. A wildcard here lets the question "is the
red one banned" resolve the words "the red". The assistant then answers with
confidence about a card that nobody asked about.

## Add a quota or a payment

Write a `Gate` object. Nothing inside these packages changes.

```ts
const gate: Gate = {
  async allow(ctx) {
    const used = await countToday(ctx.caller?.id)
    return used < 20
      ? { allow: true }
      : { allow: false, reason: "That is your 20 questions for today.", status: 429, retryAfterSeconds: 3600 }
  },
  async record(ctx, answer) {
    await recordUsage(ctx.caller?.id, answer.usage)
  },
}

createAskHandler({ pipeline, agent, gate, identify: (req) => ({ id: readUserId(req) }) })
```

The method `allow` runs before every stage, so a refusal costs nothing. The
method `record` runs after the answer, and it receives the cost. The browser
does not receive that number.

### The cost of an answer

The field `answer.usage` holds the token counts. It also holds the price, when a
provider reports one:

```ts
{ prompt_tokens: 39663, completion_tokens: 930, cost_usd: 0.0886,
  cache_read_input_tokens: 0, cache_creation_input_tokens: null, agent_steps: 5 }
```

**The value `cost_usd` comes from the provider, and never from a price table in
this project.** A gateway that priced the call reports the price, and this field
holds that number. A provider that reports no price leaves the field null. Null
is different from zero: a zero reads as a free answer, and it makes any average
that you calculate too low.

If your provider reports no price, calculate the price of the tokens yourself in
`record`. This project ships no price table. A table of prices for each model
becomes wrong without any warning, and it belongs to your fork.
