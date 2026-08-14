---
name: rulekit-corpus
description: Write a corpus and a profile for a game that rulekit does not ship. Use when the user wants rulekit to answer for their own game, or names `corpus-format`, `profile.json`, `rulings.json`, `rulekit init`, or `rulekit validate`.
---

# Write a corpus

**Check first.** Five corpora already exist. When the game is one of these, point
the app at that corpus and stop here.

| Name | The game | Where it is |
|---|---|---|
| `demo` | An invented trading card game | Inside the package |
| `chess` | Chess | Inside the package |
| `texas-holdem` | Texas Hold'em poker | Inside the package |
| `estate-line` | An invented property trading game | Inside the package |
| `riftbound` | Riftbound | The repository only. Riot Games owns it. |

**Copy the one whose shape matches the new game.** A game with no cards starts
from `chess`. A game whose cards carry prices rather than combat values starts
from `estate-line`. The four that ship carry a CC0 1.0 dedication, so a
commercial product may build on any of them.

## Step 1: copy the worked example

```bash
npx rulekit init my-game --corpus demo   # or chess, texas-holdem, estate-line
npx rulekit validate my-game             # passes on the copy
```

Inside a clone of the rulekit repository, write `pnpm rulekit` instead of `npx
rulekit`, and the corpora are the directories under `data/`.

Replace the contents of `demo` one file at a time, and validate after each.

## Step 2: write the nine files

Each file is `{ "schemaVersion": 2, "items": [] }`. `game.json` holds `game`
instead of `items`.

| File | Required | Note |
|---|---|---|
| `game.json`, `rules.json`, `rulebooks.json`, `sections.json` | Yes | |
| `terms.json`, `errata.json`, `banlist.json`, `patch-notes.json`, `cards.json` | Yes | May hold an empty list. |
| `rulings.json` | No | The one file you may leave out entirely. See step 2b. |

A missing file fails the load, so a game with no banned cards still ships
`banlist.json` with an empty list. `rulekit validate` reports any JSON file it
does not recognise, so it catches a misspelt name rather than reading it as
"this game has none".

**Start with `rules.json` alone.** The assistant works with everything else
empty, and answers fewer kinds of question for free.

<https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md> states
every field.

## Step 2b: write `rulings.json`, when you have rulings

Three things look alike. Tell them apart:

- A **rule** is the published text.
- An **erratum** changes that text.
- A **ruling** reads the unchanged text and says what it means in one case, so
  it carries a `question` and an `answer`.

Read [`rulings.md`](rulings.md) beside this file for the shape, the three kinds,
and what validation checks. A ruling you cannot copy belongs on somebody else's
website, and `rulekit-references` covers that.

## Step 3: three fields decide whether it works

- **`parent_id`** is data, not something to derive. Rule numbers repeat across
  books, so one number can name two rules with two parents.
- **`rule_type`** separates a heading from a rule. A heading with empty content
  stays out of search results, so a search never returns blank rows.
- **`is_deprecated`** keeps superseded text out of search. The rule stays
  reachable by number. Quoting superseded text as current is a wrong answer.

## Step 4: a card is any **nameable piece**

**Fill `cards.json` even when the game has no cards.** The name comes from
trading card games, and the file holds every nameable piece.

| The game | What goes in `cards.json` |
|---|---|
| A trading card game | The cards |
| Chess | The six pieces |
| Poker | The 52 cards of the pack |
| A property board game | The deeds and the fortune cards |
| A sport | The positions, or the equipment |

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

**A key with no value must be absent.** The loader drops `null` and `""`.

**Put a piece in `terms.json` as well.** The two do different work: a term
answers "what is a knight" with no model call, and a card gives the assistant
the numbers to reason with. The `chess` corpus lists each piece in both.

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
holds none: a tool that answers only "nothing found" wastes a turn. A game with
pieces lists them and sets this to `true`, even when nobody calls them cards.

**The grounding rules are built in.** Cite everything, quote rather than
restate, never invent. A profile adds to them and cannot remove them.

## Step 6: build and judge it

```bash
npx rulekit validate my-game
npx rulekit build my-game
npx rulekit ask my-game "what is <a keyword in the game>"
```

`ask` uses no model and no key, so judge a corpus before you connect anything.
It runs the free stages only, so give it a rule number or a keyword. A question
of any other shape reports a miss, because it reaches no agent.

Watch for these failures:

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
