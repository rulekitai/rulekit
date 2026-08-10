---
name: rulekit-corpus
description: Write a corpus and a profile for a game that does not ship with rulekit. Covers the eight JSON files, the two card maps, the profile fields that decide answer quality, and what validation checks. Use when the user wants rulekit to answer for their own game, mentions writing a corpus, `corpus-format`, `profile.json`, `rulekit init`, or `rulekit validate`, or asks how to get their rules and cards into the assistant.
---

# Write a corpus

**Check first.** Five corpora already ship. If the game is one of these, this
skill does not apply: point the app at the directory instead.

| Directory | The game |
|---|---|
| `data/riftbound/` | Riftbound |
| `data/chess/` | Chess |
| `data/texas-holdem/` | Texas Hold'em poker |
| `data/estate-line/` | An invented property trading game |
| `data/demo/` | An invented trading card game |

**Copy the one whose shape matches the new game.** A game with no cards should
start from `chess/`. A game whose cards carry prices rather than combat values
should start from `estate-line/`. All four of those are public domain.

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

## Step 4: "cards" means the pieces a player can name

**Do not skip `cards.json` because the game has no cards.** The name comes from
trading card games, and the file is for any nameable game object.

| The game | What goes in `cards.json` |
|---|---|
| A trading card game | The cards |
| Chess | The six pieces |
| Poker | The 52 cards of the pack |
| A property board game | The deeds and the fortune cards |
| A sport | The positions, or the equipment |

A reader who asks "what is a knight" gets a real answer when the knight is in
this file, and gets nothing when it is not.

A card fixes only its identity. Everything else goes in two maps the game names
itself:

```json
{ "id": "d1", "name": "Iron Duellist", "type_line": "Duellist",
  "text":  { "blade_text": "Parry: negate the first strike." },
  "stats": { "attack": 7, "defence": 4 } }
```

```json
{ "id": "piece-knight", "name": "Knight", "type_line": "Piece",
  "text":  { "movement_text": "Two squares along a rank or a file, then one at a right angle." },
  "stats": { "notation_symbol": "N", "piece_value": 3, "count_per_player": 2 } }
```

Both are cards. No game carries another game's empty columns.

**A key with no value must be absent.** `null` and `""` are both dropped.

**Put a piece in `terms.json` as well.** The two do different work: a term
answers "what is a knight" with no model call, and a card gives the assistant
the numbers to reason with. `data/chess/` lists each piece in both.

## Step 5: write the profile

The shortest profile that works:

```json
{ "game": { "name": "My Game" }, "cards": { "enabled": false } }
```

Then add these, in this order of value:

1. **`cards.textFields`**: every text box a card uses. **This is the highest
   value line in the file.** Without it a model reads the first box, finds an
   equip line, and reports that the card does nothing.
2. **`cards.noun`**: what the game calls one piece. Every sentence the model
   reads about the card tools is built from it, so chess sets `"piece"` and its
   tools say "find Chess pieces". It defaults to `"card"`.
3. **`cards.statFields`**: the printed values whose names do not explain them.
   `price: 70` names no currency. `rank_value: 14` names no scale. List only
   those: `rarity` explains itself, and each entry costs prompt on every card
   question.
4. **`vocabulary`**: the game's own words. A model trained on other games
   reaches for their words, and a player loses trust fast.
5. **`tokens`**: how symbols are written, if the game has them.
6. **`scope`**: what to answer, and what to refuse.

Set `cards.enabled` to `false` **only when the game has no nameable pieces at
all**. The card tools are then not registered, which is right for a corpus that
holds none: a tool that can only answer "nothing found" wastes a turn and
teaches the model to distrust the result. A game with pieces should list them
and set this to `true`, even when nobody would call them cards.

**The grounding rules are built in.** Cite everything, quote rather than
restate, never invent. A profile adds to them and cannot remove them.

## Step 6: build and judge it

```bash
pnpm rulekit validate my-game
pnpm rulekit build my-game
pnpm rulekit ask my-game "what is <a keyword in the game>"
```

`ask` uses no model and no key, so judge a corpus before connecting anything. It
runs the free stages only. Ask it a rule number or a keyword. A question of any
other shape reports a miss, because it reaches no agent.

Watch for three failures:

- **It invents.** Data is missing. Add it.
- **It quotes the wrong rule.** `rule_type` or `is_deprecated` is unset.
- **It reads a card wrong.** A text box is missing from `cards.textFields`.
- **It states a number without its unit.** The stat is missing from
  `cards.statFields`.

## Completion criterion

`rulekit validate` prints `Valid.`, `rulekit build` writes `corpus.db`, and
`rulekit ask` answers a keyword question from the glossary.

## Next

- Prove it invents nothing: `rulekit-verify`
