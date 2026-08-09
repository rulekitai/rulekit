---
name: rulekit-corpus
description: Write a corpus and a profile for a game that does not ship with rulekit. Covers the eight JSON files, the two card maps, the profile fields that decide answer quality, and what validation checks. Use when the user wants rulekit to answer for their own game, mentions writing a corpus, `corpus-format`, `profile.json`, `rulekit init`, or `rulekit validate`, or asks how to get their rules and cards into the assistant.
---

# Write a corpus

**Check first.** `data/riftbound/` already holds a full Riftbound corpus and
profile. If the game is Riftbound, this skill does not apply.

## Step 1: copy the worked example

```bash
pnpm rulekit init my-game
pnpm rulekit validate my-game    # passes on the copy
```

`data/demo/` is a small invented game that uses every field. Replace its
contents one file at a time, and validate after each.

## Step 2: write the eight files

Each file is `{ "schemaVersion": 2, "items": [] }`. `game.json` holds `game`
instead of `items`.

| File | Required | Note |
|---|---|---|
| `game.json`, `rules.json`, `rulebooks.json`, `sections.json` | Yes | |
| `terms.json`, `errata.json`, `banlist.json`, `patch-notes.json`, `cards.json` | Yes | May hold an empty list. |

A file that must exist may be empty. A missing file fails the load, because
"empty" and "I forgot this one" must not look the same.

**Start with `rules.json` alone.** The assistant works with everything else
empty. It answers fewer kinds of question for free.

`docs/corpus-format.md` states every field.

## Step 3: three fields decide whether it works

- **`parent_id`** is data, not something to derive. Rule numbers repeat across
  books, so one number can name two rules with two parents.
- **`rule_type`** separates a heading from a rule. A heading with empty content
  stays out of search results, so a search never returns blank rows.
- **`is_deprecated`** keeps superseded text out of search. The rule stays
  reachable by number. Quoting superseded text as current is a wrong answer.

## Step 4: cards name their own fields

A card fixes only its identity. Everything else goes in two maps the game names
itself:

```json
{ "id": "d1", "name": "Iron Duellist", "type_line": "Duellist",
  "text":  { "blade_text": "Parry: negate the first strike." },
  "stats": { "attack": 7, "defence": 4 } }
```

A game with Attack and Defence writes those keys. No game carries another
game's empty columns.

**A key with no value must be absent.** `null` and `""` are both dropped.

## Step 5: write the profile

The shortest profile that works:

```json
{ "game": { "name": "My Game" }, "cards": { "enabled": false } }
```

Then add these, in this order of value:

1. **`cards.textFields`**: every text box a card uses. **This is the highest
   value line in the file.** Without it a model reads the first box, finds an
   equip line, and reports that the card does nothing.
2. **`vocabulary`**: the game's own words. A model trained on other games
   reaches for their words, and a player loses trust fast.
3. **`tokens`**: how symbols are written, if the game has them.
4. **`scope`**: what to answer, and what to refuse.

Set `cards.enabled` to `false` when the corpus holds no cards. The card tools
are then not registered. A tool that can only answer "nothing found" wastes a
turn and teaches the model to distrust the result.

**The grounding rules are built in.** Cite everything, quote rather than
restate, never invent. A profile adds to them and cannot remove them.

## Step 6: build and judge it

```bash
pnpm rulekit validate my-game
pnpm rulekit build my-game
pnpm rulekit ask my-game "what is <a keyword in the game>"
```

`ask` uses no model and no key, so judge a corpus before connecting anything.

Watch for three failures:

- **It invents.** Data is missing. Add it.
- **It quotes the wrong rule.** `rule_type` or `is_deprecated` is unset.
- **It reads a card wrong.** A text box is missing from `cards.textFields`.

## Completion criterion

`rulekit validate` prints `Valid.`, `rulekit build` writes `corpus.db`, and
`rulekit ask` answers a keyword question from the glossary.

## Next

- Prove it invents nothing: `rulekit-verify`
