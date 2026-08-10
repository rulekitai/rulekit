# The corpus format

A corpus is a directory of JSON files. It is the only input that this project
accepts, and you decide how to produce it.

Start with a copy of the complete example:

```bash
pnpm rulekit init my-game
pnpm rulekit validate my-game
```

The directory `data/demo/` is that example. Every field below appears in it.

## The files

| File | What it holds | Necessary |
|---|---|---|
| `game.json` | The name and the slug of the game | Yes |
| `rules.json` | Every rule | Yes |
| `rulebooks.json` | The books that hold the rules | Yes |
| `sections.json` | The chapters inside a book | Yes |
| `terms.json` | Defined terms and keywords | Yes. It can be empty. |
| `errata.json` | Published changes to the text of a piece | Yes. It can be empty. |
| `banlist.json` | Banned and restricted cards | Yes. It can be empty. |
| `patch-notes.json` | Update notes | Yes. It can be empty. |
| `cards.json` | The pieces of the game that a player can name | Yes. It can be empty. |
| `profile.json` | How the assistant speaks about this game | No. Write one. |

A necessary file can hold an empty list. An absent file stops the load. "This
list is empty" and "I forgot to write this file" must look different.

**An empty file costs nothing at run time.** The assistant gets a tool for
`errata.json`, `banlist.json`, and `patch-notes.json` only when that file holds
a row. A game with no banned list therefore gets no banned-list tool, and it
never spends a turn on an empty answer.

## The format of every file

Each file is an object, and not a list:

```json
{ "schemaVersion": 2, "items": [] }
```

The file `game.json` is the exception:
`{ "schemaVersion": 2, "game": { ... } }`.

**The loader examines `schemaVersion` before it reads anything else.** It
refuses a version that it does not know, and it does not read the file. A field
that moved between versions would otherwise arrive empty. An assistant that lost
its `content` field answers every question from nothing.

## game.json

```json
{ "schemaVersion": 2, "game": { "slug": "paper-kingdoms", "name": "Paper Kingdoms" } }
```

The corpus states its own name here, and nothing else. The way that the
assistant speaks about the game belongs in `profile.json`.

## rulebooks.json

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. Any stable value. |
| `name` | string | |
| `slug` | string | |
| `version` | string or null | |
| `effective_date` | string or null | `YYYY-MM-DD` |
| `is_active` | boolean | The default is true |

The order is important. When a rule number appears in more than one book, the
code uses the first active book in this list.

## sections.json

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique |
| `rule_book_id` | string | It must name a rulebook |
| `section_number` | string | |
| `title` | string | |
| `slug` | string or null | |
| `description` | string or null | |
| `display_order` | number | |

## rules.json

This is the most important file.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique |
| `rule_book_id` | string | It must name a rulebook |
| `section_id` | string or null | It must name a section |
| `parent_id` | string or null | It must name a different rule |
| `rule_number` | string | As printed, for example `300.2.a` |
| `slug` | string or null | |
| `title` | string or null | |
| `content` | string | The rule text. It can be empty for a heading. |
| `example` | string or null | |
| `depth` | number | 0 for a top-level rule |
| `display_order` | number | The order among the rules at the same level |
| `rule_type` | string | `rule`, `sub_rule`, `section_header` |
| `keywords` | string[] | |
| `cross_references` | string[] | The rule NUMBERS that this rule points at |
| `is_deprecated` | boolean | |
| `deprecation_note` | string or null | |

Three fields decide the quality of the assistant:

**`parent_id` is data. The code does not calculate it.** Rule numbers repeat
between books, so one number can name two rules with two different parents.
Write the link.

**`rule_type` separates a heading from a rule.** The code keeps a heading with
empty `content` out of the search results. A search that returns empty rows puts
nothing at the top of the answer.

**`is_deprecated` keeps superseded text out of the search results.** A rule with
this flag stays available by its number, so a reader can still find it, and it
never answers a current question. A quotation of superseded text as current text
is a wrong answer, and not an incomplete one.

The field `cross_references` holds rule NUMBERS, and not ids, because a printed
rule cites a number. The code resolves them inside the same book.

## terms.json

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique |
| `term` | string | As printed |
| `slug` | string | |
| `definition` | string | The full definition |
| `short_definition` | string or null | |
| `category` | string or null | For example `keyword_ability` |
| `aliases` | string[] | Other spellings that readers use |
| `defining_rule_id` | string or null | It must name a rule |
| `defining_rule_number` | string or null | |

The terms make "what is X?" free and exact. The field `aliases` is more valuable
than it appears. A reader who types a synonym reaches the definition, or reaches
nothing.

## cards.json

| Field | Type |
|---|---|
| `id`, `name` | string, necessary |
| `type_line`, `rarity`, `set_name` | string or null |
| `png_uri` | string or null |
| `tags` | a list of strings |
| `text` | a map from your own text-box names to their text |
| `stats` | a map from your own attribute names to their values |

**"Cards" means the pieces of your game that a player can name.** The word comes
from trading card games, and it fits them. The file also accepts any game object
that has a name. Put the things that a player points at into it:

| Your game | What goes into `cards.json` |
|---|---|
| A trading card game | The cards |
| Chess | The six pieces. `data/chess/` does this. |
| Poker | The 52 cards of the pack. `data/texas-holdem/` does this. |
| A property board game | The deeds and the fortune cards. `data/estate-line/` does this. |
| A sport | The positions, or the equipment |

**Leave this file empty only when your game has no pieces that a player can
name.** A reader who asks "what is a knight" gets a real answer when the knight
is in this file. That reader gets nothing when the knight is absent.

A piece often belongs in `terms.json` as well. The two files do different work.
A term gives a short definition with no model call. A card gives the numbers and
the printed text that the assistant reads. The corpus `data/chess/` lists each
piece in both files.

Only the identity of a card is fixed, because only the identity is the same in
every game. The text boxes and the printed attributes of your game go in the two
maps, under the names that your game prints:

```json
{
  "id": "pk-006", "name": "Ironbrand Blade", "type_line": "Gear — Weapon",
  "text": { "card_text": "Equip 2.", "effect_text": "The equipped unit has Guard." },
  "stats": { "energy": 2, "might_bonus": 2, "colors": ["stone"] }
}
```

Here is the same file for a game that has no cards:

```json
{
  "id": "piece-knight", "name": "Knight", "type_line": "Piece",
  "text": { "movement_text": "The knight moves two squares along a rank or a file, then one square at a right angle." },
  "stats": { "notation_symbol": "N", "piece_value": 3, "count_per_player": 2 }
}
```

A game with Attack and Defence writes those two keys. No game holds the empty
columns of a different game, and no field is called `mana_cost` in a game that
has no mana.

**A key with no value must be absent.** The loader removes both
`"flavor_text": null` and `"flavor_text": ""`. To a reader, "this card has no
flavour text" and "this game has no flavour text" are the same. An empty field
also invites the model to write a sentence about the absence.

**The `text` map usually holds more than one box.** An equipment card often
prints almost nothing in its own box, and everything in the box that its holder
gains. Name each box in `profile.json`. The assistant then reads all of them
before it states that a card does not do something.

A value in `stats` can be a number, a text string, or a list. The type stays the
same through the database, so a `2` returns as a number.

**Describe a value whose name does not explain it.** A value reaches the
assistant as a name and a number. That is enough for `rarity`. It is not enough
for `price: 70`, which names no currency, or for `rank_value: 14`, which names
no scale. The field `cards.statFields` in `profile.json` gives each one a
sentence. List only the values that a reader cannot calculate. Each described
value costs prompt text for every card question, and "price is the price"
teaches nothing.

The field `png_uri` holds a relative path. Nothing shows the image until a host
application states where the images are, with `cardImageUrl` on the provider.

## errata.json and banlist.json

Both files name a card inside the row, so a legality answer needs no card
lookup:

```json
{ "id": "ban-001",
  "card": { "id": "pk-005", "name": "Borrowed Hour", "png_uri": "…/PK-005.webp" },
  "format": { "id": "fmt-standard", "name": "Standard", "slug": "standard" },
  "entry_type": "banned",
  "effective_date": "2026-03-01",
  "reason": "…" }
```

An erratum holds `original_text`, `errata_text`, and `explanation` in place of a
format and a type.

**In practice, `effective_date` is necessary.** The assistant does not state
that a card is legal unless the list holds a date. Nobody can audit a statement
with no date against the list that produced it.

## patch-notes.json

This file holds `id`, `slug`, `title`, `version`, `effective_date`, `category`,
`summary`, and `body`. It also holds `affected_rule_ids` and
`affected_card_ids`.

## What validation examines

The command `rulekit validate` examines more than the format:

- Every `rule_book_id`, `section_id`, `parent_id`, and `defining_rule_id` names
  something that exists.
- No rule is its own parent, and no chain of parents forms a cycle. A cycle
  stops every tool that reads upward, and this check finds it in one second.
- The corpus holds one rule or more.

The loader removes a row that fails validation, and it reports that row. The
other rows still load. One incorrect card must not cost a reader the whole
rulebook.

## How to produce a corpus

Use any method. Write the JSON by hand, export it from a database that you
already have, or write a scraper in any language. This project ships no importer
on purpose. Data collection holds every detail that is specific to one source. A
project with no importer stays neutral, and it stays correct when another person
changes their page.
