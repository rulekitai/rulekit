# Adding a game

Four steps. Two of them are writing JSON.

```bash
pnpm rulekit init my-game        # copy the worked example
# ... replace its contents with yours ...
pnpm rulekit validate my-game    # names every problem
pnpm rulekit build my-game       # compiles to my-game/corpus.db
pnpm rulekit ask my-game "what is <a keyword in your game>"
```

That last command answers with no model and no key, so you can judge a corpus
before you connect anything.

## 1. The corpus

`docs/corpus-format.md` states every field. `data/demo/` is a complete example
of all of them.

Start with `rules.json` alone if you like. Terms, cards, errata, and the banned
list may all be empty lists, and the assistant works without them — it simply
answers fewer kinds of question for free.

## 2. The profile

`profile.json` holds everything about your game the instructions cannot know.
The grounding rules — cite everything, quote rather than restate, never invent —
are built in and cannot be removed by a profile. This adds to them.

The shortest profile that works:

```json
{ "game": { "name": "My Game" }, "cards": { "enabled": false } }
```

Then sharpen it.

### Your game's words

```json
"vocabulary": [
  { "use": "Resolve", "insteadOf": ["toughness"], "means": "It names how much damage a unit survives." }
]
```

Worth doing. A model trained on other games will reach for their words, and a
player reading their own game's rules in another game's vocabulary loses trust
fast.

### Cards

```json
"cards": {
  "enabled": true,
  "linkScheme": "card",
  "maxInlineImages": 3,
  "textFields": [
    { "field": "card_text", "describes": "the card's own text box" },
    { "field": "effect_text", "describes": "the box an equipped holder gains" }
  ]
}
```

Set `enabled` to false when your corpus has no cards, and the card tools are not
registered at all. Offering a tool that can only answer "nothing found" wastes a
turn and teaches the model to distrust the result.

**List every text field your cards use.** This is the single highest-value line
in a profile. Without it, a model reads the first field, finds an equip line, and
reports that the card does nothing.

### Symbols

```json
"tokens": {
  "syntax": "[Fury] or [Shield 2]",
  "groups": [ { "label": "Runes", "examples": ["[Fury]", "[Calm]"] } ]
}
```

Leave it out for a game with no symbols, and answers use plain words. A rulebook
uses square brackets in ordinary prose too, so nothing is rewritten unless you
ask for it.

### Scope

```json
"scope": {
  "answer": ["Rule text and rule numbers.", "Whether a card may be played."],
  "refuse": ["Anything about the digital client."]
}
```

The universal refusals — strategy, prices, real people, off-topic questions —
are built in. This adds to them.

## 3. Wire it up

The example app reads one variable:

```bash
RULEKIT_CORPUS=my-game pnpm dev
```

In your own app it is a handful of lines:

```ts
import { parseProfile } from "@rulekit/agent/profile"
import { createRulesAgent } from "@rulekit/agent/runtime"
import { SqliteStore } from "@rulekit/corpus/sqlite-store"
import { createPipeline } from "@rulekit/pipeline/pipeline"
import { exactCacheStage } from "@rulekit/pipeline/stages/cache"
import { glossaryStage } from "@rulekit/pipeline/stages/glossary"
import { staticAnswersStage } from "@rulekit/pipeline/stages/static"
import { createAskHandler } from "@rulekit/server/handler"

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

`createAskHandler` returns a plain function from `Request` to `Response`, so the
same export works in Next.js, Hono, Bun, Deno, and a Cloudflare Worker.

## 4. Judge it

Ask the questions your players actually ask. Watch for three failures:

**It invents.** Something is missing from the corpus and the model filled the
gap. Add the data. If it keeps happening on questions the corpus does cover,
your `content` fields are probably too short to answer from.

**It quotes the wrong rule.** Usually `rule_type` or `is_deprecated` is not set,
so headings and superseded text are crowding the search results.

**It reads a card wrong.** Almost always a missing entry in
`cards.textFields`.

## Tuning what happens for free

The order of the stages is yours:

```ts
stages: [exactCacheStage(), staticAnswersStage(store), glossaryStage(store)]
```

The static stage's patterns are configurable, because different games number
rules differently and ask about legality in different words:

```ts
staticAnswersStage(store, {
  classify: {
    ruleNumberPattern: String.raw`\d{1,3}(?:\.\d{1,3})*`,
    legalityWords: ["banned", "legal", "allowed", "tournament legal"],
    formatWords: ["standard", "open", "casual"],
  },
})
```

Every word list is closed on purpose. A wildcard here would let "is the red one
banned" resolve "the red" and answer confidently about a card nobody asked
about.

## Adding quotas or billing

Implement `Gate`. Nothing inside these packages changes.

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

`allow` runs before any stage, so a refusal costs nothing at all. `record` runs
after, with the full answer including what it cost. The browser never receives
that figure.

### What an answer costs

`answer.usage` carries the token counts and, when a provider reports one, the
price:

```ts
{ prompt_tokens: 39663, completion_tokens: 930, cost_usd: 0.0886,
  cache_read_input_tokens: 0, cache_creation_input_tokens: null, agent_steps: 5 }
```

**`cost_usd` comes from the provider, never from a price table here.** A gateway
that already priced the call reports it and this reads that figure. A provider
that reports nothing leaves it null, and null is not zero: a zero reads as a
genuinely free answer and would drag any average you compute downwards.

If your provider reports no price, price the tokens yourself in `record`. This
project ships no table, because a table of per-model prices goes stale silently
and is the fork's to keep, not this project's.
