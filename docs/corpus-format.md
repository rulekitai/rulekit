# The corpus format

A corpus is a directory of JSON files. It is the only input that this project
accepts.

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
| `rulings.json` | Published rulings: a question, an answer, and the rules it rests on | No. It can be absent. |
| `profile.json` | How the assistant speaks about this game | No. Write one. |
| `NOTICE.txt` | Who owns this data, written for a developer | No. Write one when the data is not yours. |

A necessary file can hold an empty list. An absent one stops the load. "This
list is empty" and "I forgot to write this file" must look different.

**`rulings.json` is the one collection you may leave out.** `rulekit validate`
names any JSON file that it does not recognise, so it reports a misspelt
`rulingz.json`. Nothing reads that file as "this game has no rulings".
[Design decisions](design-decisions.md) gives the reason for the exception.

**An empty file costs nothing at run time.** The assistant gets a tool for
`errata.json`, `banlist.json`, `patch-notes.json`, and `rulings.json` only when
that file holds a row. A game with no banned list therefore gets no banned-list
tool, and it never spends a turn on an empty answer.

## The format of every file

Each file is an object, and not a list:

```json
{ "schemaVersion": 2, "items": [] }
```

The file `game.json` is the exception:
`{ "schemaVersion": 2, "game": { ... } }`.

**The loader examines `schemaVersion` before it reads anything else.** It
refuses a version that it does not know, and it reads no row. A field that moved
between versions would otherwise arrive empty, and an assistant that lost its
`content` field answers every question from nothing.

## game.json

```json
{ "schemaVersion": 2, "game": { "slug": "paper-kingdoms", "name": "Paper Kingdoms" } }
```

The corpus states its own name here, and nothing else. The way the assistant
speaks about the game belongs in `profile.json`.

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
this flag stays available by its number, and it never answers a current
question. Superseded text quoted as current text is a wrong answer, and not an
incomplete one.

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

The terms make "what is X?" free and exact. Write `aliases`: a reader who types
a synonym you listed reaches the definition, and a reader who types one you did
not list reaches nothing.

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
from trading card games, and the file accepts any game object that has a name.
Put the things that a player points at into it:

| Your game | What goes into `cards.json` |
|---|---|
| A trading card game | The cards |
| Chess | The six pieces. `data/chess/` does this. |
| Poker | The 52 cards of the pack. `data/texas-holdem/` does this. |
| A property board game | The deeds and the fortune cards. `data/estate-line/` does this. |
| A sport | The positions, or the equipment |

**Leave this file empty only when your game has no piece that a player can
name.** A reader who asks "what is a knight" gets a real answer when the knight
is in this file. That reader gets nothing when the knight is absent.

A piece often belongs in `terms.json` as well, because the two files do
different work. A term gives a short definition with no model call. A card gives
the numbers and the printed text that the assistant reads. The corpus
`data/chess/` lists each piece in both files.

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

A game with Attack and Defence writes those two keys, and it holds no empty
column of another game.

**A key with no value must be absent.** The loader removes both
`"flavor_text": null` and `"flavor_text": ""`. To a reader, "this card has no
flavour text" and "this game has no flavour text" are the same. An empty field
also invites the model to write a sentence about the absence.

**The `text` map usually holds more than one box.** An equipment card often
prints almost nothing in its own box, and everything in the box that its holder
gains. Name each box in `profile.json`, and the assistant then reads all of them
before it states that a card does not do something.

A value in `stats` can be a number, a text string, or a list. The type stays the
same through the database, so a `2` returns as a number.

**Describe a value whose name does not explain it.** A value reaches the
assistant as a name and a number. That is enough for `rarity`. It is not enough
for `price: 70`, which names no currency, or for `rank_value: 14`, which names
no scale. The field `cards.statFields` in `profile.json` gives each one a
sentence. List only those values, because each one costs prompt text for every
card question.

**No corpus here ships the card pictures, and none of them can.** A card picture
belongs to whoever owns the game, and this project grants no rights to any of
them. The field `png_uri` holds a relative path, and `cardImageUrl` on the
provider has nothing to point at until an application hosts its own copies
lawfully.

**Draw the name instead, and mark it.** This works with every corpus, and a
reader still sees that the assistant matched a real card rather than typing a
word. Pass `renderers.card` and no `cardImageUrl`. The example application in
this repository does exactly that, in `CardChip`.

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
that a card is legal unless the list holds a date. Nobody can audit an undated
statement against the list that produced it.

## patch-notes.json

This file holds `id`, `slug`, `title`, `version`, `effective_date`, `category`,
`summary`, and `body`. It also holds `affected_rule_ids` and
`affected_card_ids`.

## rulings.json

A rule is the published text. An erratum changes that text. A ruling reads the
unchanged text and says what it means in one case. A ruling therefore carries a
`question` and an `answer`, and the other two carry statements.

```json
{ "id": "rul-001",
  "kind": "card",
  "question": "Does Guard force an attack to be blocked by that unit?",
  "answer": "No. Guard makes the unit eligible to block, and the defender still chooses.",
  "cards": [{ "id": "pk-001", "name": "Stonewall Sentry", "png_uri": "…/PK-001.webp" }],
  "rule_numbers": ["300.2", "300.2.a", "800.1"],
  "topic": "blocking",
  "source_name": "Paper Kingdoms Rules Team",
  "source_url": "https://example.com/rulings/guard",
  "is_official": true,
  "effective_date": "2026-03-01" }
```

`kind` separates the three uses of a ruling, and they carry different authority:

| `kind` | It answers | `cards` |
|---|---|---|
| `card` | A question about named pieces | One or more. Necessary |
| `general` | A mechanic or a timing, naming no piece | Empty |
| `policy` | Running an event: registration, penalties, conduct | Usually empty |

`rule_numbers` names the rules that the answer rests on, and validation resolves
each one. It turns a ruling from an assertion into something a reader can check.

**`is_official` is false unless you set it.** Most rulings that anybody can
collect are somebody's careful reading, and not a publisher's word. A reader who
is told that an unofficial ruling is official cannot detect the difference.

**A `kind` that this format does not know DROPS the row and reports it.** Every
other field falls back, because an absent one means "this game has none". A
misspelt `kind` means the opposite: the writer said something specific and got
it wrong, and a card ruling filed as `general` sits where no card lookup reaches
it.

Set `is_deprecated` on a withdrawn ruling. It stays out of search, as a
deprecated rule does. A reader who asks for every ruling on one piece still sees
it, with a label.

**Set `source_url` beside `source_name`.** The answer prints the name as a link
to that address, which is what a licence such as CC BY-SA asks for. The name
alone leaves the obligation impossible to meet.

### Which questions a ruling answers free

Two shapes reach the rows in a few milliseconds, with no model call:

| The reader asks | What answers |
|---|---|
| `rulings for Stonewall Sentry` | The free stage |
| `Stonewall Sentry faq` | The free stage |
| The `question` field, word for word | The free stage |
| `Can Stonewall Sentry block two attackers?` | The agent. It costs a model call |

The first two are a **lookup**: the word "rulings" or "faq", plus a piece this
corpus knows. The third is an **exact match** on the question the ruling itself
asks, folded for case, spacing, accents, and a final question mark.

Nothing else matches, and that is deliberate. A ruling that merely resembles the
question is the wrong answer, and presenting it as the right one is worse than
paying for a model call. The agent reads the rules underneath a ruling and
weighs them; the free stage cannot.

**Write `question` as the reader would type it.** It is the phrasing they read
on the publisher's page, and it is the one phrasing that costs nothing.

## profile.json

The profile says how the assistant SPEAKS about this game: its words, its card
fields, its symbols, and what it declines.
[Adding a game](adding-a-game.md#2-the-profile) covers those field by field.

One field belongs here instead, because it describes the DATA rather than the
speech.

### attribution

One sentence for the READER about who owns these rules.

```json
"attribution": {
  "text": "Riot Games, Inc. owns the Riftbound rules data. This is an unofficial community project, and Riot Games does not endorse it.",
  "url": "https://www.riotgames.com/en/legal",
  "official": false
}
```

| Field | Necessary | What it holds |
|---|---|---|
| `text` | Yes | The sentence itself. Write it for a reader, not for a developer |
| `url` | No | Where a reader goes to read the terms in full |
| `official` | No | True only when the rights holder publishes this assistant. Default false |

**`official` here is not `official` on a ruling.** On a ruling it means the
publisher wrote that ruling. Here it means the publisher runs this whole
assistant. Almost every assistant sets false, and false is what says "unofficial
community project" to a reader who is deciding how much to trust the answer.

**`url` is a link on the credit, and nothing reads it for you.** Render all
three yourself:

```tsx
<RuleKitProvider
  legalNote={
    <>
      {profile.attribution?.text}{" "}
      {profile.attribution?.url ? <a href={profile.attribution.url}>Terms</a> : null}
    </>
  }
/>
```

**Nothing sends `attribution` to the model.** It is a credit an interface
prints, and not an instruction.

**Why the field exists.** A corpus whose data belongs to somebody carries a
`NOTICE.txt` beside its JSON, and that file is written for the developer
choosing the corpus: it names licences, directories, and what may be sold. The
person asking whether a unit can block has no use for any of it. An application
that printed the notice verbatim showed that person the wrong document. The
corpus author writes the reader's sentence once here, and every application
shows the same one.

`rulekit validate` prints a note when a corpus carries a `NOTICE.txt` and sets
no `attribution`. It is a note and never a failure: a corpus in the public
domain may reasonably say nothing to a reader.

## What validation examines

The command `rulekit validate` examines more than the format:

- Every id that points at another row names a row that exists: `rule_book_id`,
  `section_id`, `parent_id`, `defining_rule_id`, `affected_rule_ids`,
  `affected_card_ids`, and every `cards[].id` on a ruling.
- No rule is its own parent, and no chain of parents forms a cycle. A cycle
  stops every tool that reads upward, and this check finds it in one second.
- Every entry in `rule_numbers` on a ruling names a rule that exists.
- A ruling whose `kind` is `card` names one card or more.
- A ruling's `source_url`, when it holds one, is an `https` address.
- No two rulings share an id. An answer cites a ruling by id, and a reader who
  follows that citation to two rows cannot be told which one answered.
- A ruling's `cards[].name` agrees with the card that its `cards[].id` names.
  The id resolving is not enough: the answer prints the NAME, so a row that
  names the wrong card produces an answer about a card nobody asked about.
- No two terms answer to the same name or alias, because a shared name makes a
  lookup ambiguous.
- No JSON file in the directory is one that the format does not know.
- The corpus holds one rule or more.

The loader removes a row that fails validation, and it reports that row. The
other rows still load. One incorrect card must not cost a reader the whole
rulebook.

## How to produce a corpus

Use any method: write the JSON by hand, export it from a database that you
already have, or write a scraper in any language. This project ships no importer
on purpose. Data collection holds every detail that is specific to one source. A
project with no importer stays neutral, and it stays correct when another person
changes their page.
