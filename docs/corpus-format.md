# The corpus format

A corpus is a directory of JSON files. It is the only input this project takes,
and how you produce it is entirely yours.

Start by copying the worked example:

```bash
pnpm rulekit init my-game
pnpm rulekit validate my-game
```

`data/demo/` is that example. Every field below appears in it.

## The files

| File | Holds | Required |
|---|---|---|
| `game.json` | The game's name and slug | Yes |
| `rules.json` | Every rule | Yes |
| `rulebooks.json` | The books the rules belong to | Yes |
| `sections.json` | The chapters inside a book | Yes |
| `terms.json` | Defined terms and keywords | Yes, may be empty |
| `errata.json` | Published changes to a piece's text | Yes, may be empty |
| `banlist.json` | Banned and restricted cards | Yes, may be empty |
| `patch-notes.json` | Update notes | Yes, may be empty |
| `cards.json` | The pieces of the game a player can name | Yes, may be empty |
| `profile.json` | How the assistant talks about this game | No, but write one |

A file that must exist may hold an empty list. A missing file fails the load,
because "empty" and "I forgot to write this" must not look the same.

## The shape of every file

Each file is an object, not a bare list:

```json
{ "schemaVersion": 2, "items": [] }
```

`game.json` is the exception: `{ "schemaVersion": 2, "game": { ... } }`.

**`schemaVersion` is checked before anything is read.** A version the reader does
not know is refused outright rather than read anyway, because a field that moved
between versions would otherwise arrive empty and an assistant that quietly lost
`content` answers every question from nothing.

## game.json

```json
{ "schemaVersion": 2, "game": { "slug": "paper-kingdoms", "name": "Paper Kingdoms" } }
```

The corpus names itself and nothing else. How the assistant *talks* about the
game belongs in `profile.json`.

## rulebooks.json

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique. Anything stable. |
| `name` | string | |
| `slug` | string | |
| `version` | string or null | |
| `effective_date` | string or null | `YYYY-MM-DD` |
| `is_active` | boolean | Defaults to true |

The order matters. When a rule number appears in more than one book, the first
active book in this list wins.

## sections.json

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique |
| `rule_book_id` | string | Must name a rulebook |
| `section_number` | string | |
| `title` | string | |
| `slug` | string or null | |
| `description` | string or null | |
| `display_order` | number | |

## rules.json

The important file.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique |
| `rule_book_id` | string | Must name a rulebook |
| `section_id` | string or null | Must name a section |
| `parent_id` | string or null | Must name another rule |
| `rule_number` | string | As printed, e.g. `300.2.a` |
| `slug` | string or null | |
| `title` | string or null | |
| `content` | string | The rule text. May be empty for a heading |
| `example` | string or null | |
| `depth` | number | 0 for a top-level rule |
| `display_order` | number | Order among its siblings |
| `rule_type` | string | `rule`, `sub_rule`, `section_header` |
| `keywords` | string[] | |
| `cross_references` | string[] | Rule NUMBERS this rule points at |
| `is_deprecated` | boolean | |
| `deprecation_note` | string or null | |

Three fields decide whether the assistant works well:

**`parent_id` is data, not something to infer.** Rule numbers repeat across
books, so the same number can name two rules with two different parents. Write
the link; do not expect it to be derived.

**`rule_type` separates a heading from a rule.** A heading with empty `content`
is kept out of search results, because a search that returns blank rows puts
nothing at the top of the answer.

**`is_deprecated` keeps superseded text out of search.** A deprecated rule stays
reachable by number, so somebody can still look it up, but it never answers a
current question. Quoting superseded text as current is a wrong answer, not an
incomplete one.

`cross_references` holds rule NUMBERS, not ids, because that is what a printed
rule cites. They are resolved inside the same book.

## terms.json

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique |
| `term` | string | As printed |
| `slug` | string | |
| `definition` | string | The full definition |
| `short_definition` | string or null | |
| `category` | string or null | e.g. `keyword_ability` |
| `aliases` | string[] | Other spellings readers use |
| `defining_rule_id` | string or null | Must name a rule |
| `defining_rule_number` | string or null | |

Terms are what make "what is X?" free and exact. `aliases` matter more than they
look: a reader who types a synonym reaches the definition or reaches nothing.

## cards.json

| Field | Type |
|---|---|
| `id`, `name` | string, required |
| `type_line`, `rarity`, `set_name` | string or null |
| `png_uri` | string or null |
| `tags` | list of strings |
| `text` | a map of your own text-box names to their text |
| `stats` | a map of your own attribute names to their values |

**"Cards" means the pieces of your game that a player can name.** The word comes
from trading card games, and it fits them, but the file is for any nameable
game object. Fill it with whatever a player points at and asks about:

| Your game | What goes in `cards.json` |
|---|---|
| A trading card game | The cards |
| Chess | The six pieces. `data/chess/` does this. |
| Poker | The 52 cards of the pack. `data/texas-holdem/` does this. |
| A property board game | The deeds and the fortune cards. `data/estate-line/` does this. |
| A sport | The positions, or the equipment |

**Leave it empty only when your game has no nameable pieces at all.** A reader
who asks "what is a knight" gets a real answer when the knight is in this file,
and gets nothing when it is not.

A piece often belongs in `terms.json` as well. The two do different work: a term
gives a short definition with no model call, and a card gives the numbers and
the printed text the assistant reasons with. `data/chess/` lists each piece in
both.

Only identity is fixed, because only identity is the same in every game. Your
game's text boxes and printed attributes go in the two maps, under whatever
names your game prints:

```json
{
  "id": "pk-006", "name": "Ironbrand Blade", "type_line": "Gear — Weapon",
  "text": { "card_text": "Equip 2.", "effect_text": "The equipped unit has Guard." },
  "stats": { "energy": 2, "might_bonus": 2, "colors": ["stone"] }
}
```

The same file, for a game with no cards in it at all:

```json
{
  "id": "piece-knight", "name": "Knight", "type_line": "Piece",
  "text": { "movement_text": "The knight moves two squares along a rank or a file, then one square at a right angle." },
  "stats": { "notation_symbol": "N", "piece_value": 3, "count_per_player": 2 }
}
```

A game with Attack and Defence writes those keys. Nobody carries anybody else's
empty columns, and nothing is called `mana_cost` in a game that has no mana.

**A key with no value must be absent, not empty.** `"flavor_text": null` and
`"flavor_text": ""` are both dropped on load, because "this card has no flavour
text" and "this game has no flavour text" are the same thing to a reader, and an
empty field sent to a model invites it to remark on the absence.

**`text` usually holds more than one box.** An equipment card commonly prints
almost nothing in its own box and everything in the box its holder gains. Name
each one in `profile.json` so the assistant reads all of them before it says a
card does not do something.

A `stats` value can be a number, a string, or a list. The type survives the round
trip through the database unchanged, so a `2` comes back as a number.

`png_uri` is a relative path. Nothing renders it until a host app says where
images live, via `cardImageUrl` on the provider.

## errata.json and banlist.json

Both name a card inline, so a legality answer needs no card lookup:

```json
{ "id": "ban-001",
  "card": { "id": "pk-005", "name": "Borrowed Hour", "png_uri": "…/PK-005.webp" },
  "format": { "id": "fmt-standard", "name": "Standard", "slug": "standard" },
  "entry_type": "banned",
  "effective_date": "2026-03-01",
  "reason": "…" }
```

Errata carries `original_text`, `errata_text`, and `explanation` instead of a
format and a type.

**`effective_date` is not optional in practice.** The assistant will not state
that a card is *not* banned unless the list carries a date, because a verdict
with no date cannot be audited against the list it was read from.

## patch-notes.json

`id`, `slug`, `title`, `version`, `effective_date`, `category`, `summary`,
`body`, plus `affected_rule_ids` and `affected_card_ids`.

## What validation checks

`rulekit validate` checks more than shapes:

- Every `rule_book_id`, `section_id`, `parent_id`, and `defining_rule_id` names
  something that exists.
- No rule is its own parent, and no parent chain forms a cycle. A cycle hangs
  every tool that walks upward, and finding it here costs a second.
- The corpus holds at least one rule.

A row that fails validation is dropped and reported; the rest still load. One
malformed card must not cost a reader the whole rulebook.

## Producing a corpus

However you like. Write the JSON by hand, export it from a database you already
have, or write a scraper in any language. This project ships no importer on
purpose: data collection is where every source-specific detail lives, and a
project carrying none of it stays neutral and does not go stale when somebody
else changes their page.
