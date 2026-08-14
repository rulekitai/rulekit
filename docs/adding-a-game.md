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
a keyword. For a question of another type it reports that it cannot answer, and
that report tells you nothing about the corpus: the agent answers those
questions.

## 1. The corpus

[The corpus format](corpus-format.md) states every field. The directory
`data/demo/` is a complete example of all of them.

You can start with `rules.json` alone. The terms, the cards, the errata, and the
banned list can all be empty lists. The assistant then works, and it answers
fewer types of question.

### Rulings

**`rulings.json` is the one file you may leave out.** Write it when you hold
answers to questions that your rules text does not settle on its own. A rule is
the published text. An erratum changes that text. A ruling reads the unchanged
text and says what it means in one case. See
[the corpus format](corpus-format.md) for the fields.

Once the file holds a row, two things switch on by themselves. A free stage
answers from these rows with no model call, and the agent gains a `list_rulings`
tool. Both stay off while the file is absent or empty.

**Two shapes of question answer free**: a lookup such as "rulings for X", and
the `question` field of a ruling typed word for word. Every other phrasing
reaches the agent. Write `question` as the reader would type it.
[The corpus format](corpus-format.md#which-questions-a-ruling-answers-free)
gives the table.

**A ruling that you may not copy belongs on somebody else's website.** See
[reference sites](reference-sites.md) for reading one at run time instead.

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

"Cards" means the pieces of your game that a player can name. Chess lists its
six pieces, and poker lists the 52 cards of the pack. See
[the corpus format](corpus-format.md).

**Set `noun` to the word that your game uses for one of them.** The code builds
every sentence about the card tools from this word. A chess assistant therefore
gets a tool to "find Chess pieces", and never a tool for "Chess cards". The
default is "card". Also set `nounPlural` when an added "s" gives the wrong word.

Set `enabled` to false only when your game has no piece that a player can name.
The code then creates no card tool. A tool that can answer only "nothing found"
costs one turn, and it teaches the model to distrust the result.

**List every text field that your cards use.** This is the most valuable line in
a profile. Without it, a model reads the first field, finds an equipment line,
and reports that the card does nothing. The key `field` names a key of a card's
`text` map, so these are the names that your own game uses.

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

Leave this section out for a game with no symbols, and the answers then use
plain words. A rulebook also uses square brackets in ordinary sentences, so the
code rewrites nothing until you ask for it.

### Scope

```json
"scope": {
  "answer": ["Rule text and rule numbers.", "Whether a card may be played."],
  "refuse": ["Anything about the digital client."]
}
```

The refusals that apply to every game are part of the code: strategy, prices,
real people, and questions about a different subject. This section adds to them.
[Custom tools](custom-tools.md) prints the whole list, and explains why a tool
on one of those subjects is never called.

### The sentence a reader sees

```json
"attribution": {
  "text": "Riot Games, Inc. owns the Riftbound rules data. This is an unofficial community project, and Riot Games does not endorse it.",
  "url": "https://www.riotgames.com/en/legal",
  "official": false
}
```

Most rules data belongs to somebody, and a corpus states the terms in a
`NOTICE.txt` beside its JSON. **That file is written for you**, the person
choosing a corpus: it names licences, directories, and what you may sell. The
person asking whether a unit can block has no use for any of it.

Write the reader's sentence here instead. Every application built on this corpus
then shows the same one, and `NOTICE.txt` goes back to being your file. Nothing
sends `attribution` to the model: it is a credit, not an instruction.

Show it under the conversation:

```tsx
<RuleKitProvider legalNote={profile.attribution?.text}>
```

`rulekit validate` prints a note when a corpus carries a `NOTICE.txt` and sets
no `attribution`, and still reports the corpus valid.

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

## 4. Judge it

Ask the questions that your players ask. Watch for three failures:

**The assistant invents an answer.** The corpus has a gap, and the model filled
it. Add the data. If this continues for questions that the corpus does cover,
your `content` fields are probably too short to answer from.

**The assistant quotes the wrong rule.** The usual cause is an unset `rule_type`
or `is_deprecated` field. Headings and superseded text then fill the search
results.

**The assistant reads a card incorrectly.** The usual cause is a missing entry
in `cards.textFields`.

**The assistant says that the corpus holds no answer, and it is right.** The
assistant is working. You have three moves, in this order:

1. Add the rule text, if the rulebook covers it.
2. Write a ruling in `rulings.json`, if you hold one.
3. Let the assistant read a site that you name.

See [reference sites](reference-sites.md) for the third move. It is the only
move that opens a network connection. It is also the only move that marks the
answer as coming from outside your rules data.

## Adjust the free stages

You choose the order of the `stages` list above.

### Clear every cached answer at once

An answer stays in the cache for a week. When you change the corpus, the answers
already cached still quote the old rules. Raise the cache version to put all of
them out of reach in one step:

```ts
createPipeline({ store, profile, stages, cacheVersion: "2" })
```

The version is part of every cache key, so nothing has to be listed and deleted.
Set it in this one place, where the reading stage and every writer take it from.
A version set anywhere else is read at the new number and written at the old
one. That empties the cache for good, rather than once.

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
`record`. This project ships no price table, because a table of prices for each
model becomes wrong with no warning. That table belongs to your fork.
