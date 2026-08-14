# data

**rulekit works with any rulebook.** The code holds no knowledge of a particular
game. It reads the corpus that you give it, and the directories here are
examples.

The five corpora differ from each other on purpose, and one format holds them
all. This directory states the terms of use for each.

| Directory | The game | It has cards | Terms of use |
|---|---|---|---|
| `demo/` | An invented trading card game | Yes | **CC0 1.0.** Public domain. |
| `chess/` | Chess | No | **CC0 1.0.** Written for this project. |
| `estate-line/` | An invented property trading game | Yes, and they are not trading cards | **CC0 1.0.** Written for this project. |
| `texas-holdem/` | Texas Hold'em poker | No | **CC0 1.0.** Written for this project. |
| `riftbound/` | Riftbound trading card game | Yes | **The property of Riot Games.** No rights granted. |

Four of the five corpora hold no third-party rights. The tests read `demo/`, so
no test depends on data that this project does not own.

**Each directory states its own terms**, so a corpus that you copy on its own
still carries them. The four public-domain corpora hold a `LICENSE` file with
the full CC0 1.0 legal code, and a `NOTICE.txt` file that states what the
dedication covers. The directory `riftbound/` holds a `NOTICE.txt` file and no
licence file, because this project grants no rights to that data.

**This project wrote every word of the four CC0 corpora.** It copied no
rulebook, no PDF file, and no web page to make them. The rules of chess and the
rules of poker are systems, and nobody owns a system. An author owns a
particular set of words, so this project reuses none.

**The same holds for every ruling in `rulings.json`.** This project wrote the
rulings in `demo/` and `chess/`.

The two files set `is_official` differently, and each setting is correct for its
game. `chess/` marks all 6 rulings unofficial: they are this project's own
reading of a real game's rules, and no governing body approved them. `demo/`
marks 7 of its 9 official, because Paper Kingdoms is an invented game and this
project is its publisher. A corpus for a real game follows the `chess/` example.

The file `riftbound/rulings.json` holds an empty list.
Community rulings sites exist for that game, and their words belong to whoever
wrote them, so this project copied nothing from one. Read
[`../docs/reference-sites.md`](../docs/reference-sites.md) to read such a site at
run time instead.

## The Apache licence does not cover this directory

The `LICENSE` file in the root directory covers the code in `packages/`,
`templates/`, and `examples/`. It does not cover game data.

A licence file in a root directory can appear to cover every file below it. This
project cannot give a licence for a corpus that it does not own, so this
statement sets the limit. Each corpus in the table above states its own terms of
use.

## Riftbound

Riot Games, Inc. owns the data in `riftbound/`.

Riot Games' "Legal Jibber Jabber" policy permitted the creation of rulekit with
assets that Riot Games owns. Riot Games does not endorse or sponsor this
project.

**That policy permits non-commercial community use only.** To use rulekit in a
commercial product, use one of the four public-domain corpora above, or supply
your own.

Riftbound and Riot Games are trademarks of Riot Games, Inc. This project names
them only to state which data it reads.

## Write your own corpus

A corpus is an input. This project holds no importer, no scraper, and no parser,
and it fetches nothing. Write the JSON files in the way that you prefer. Then
run these two commands:

```bash
pnpm rulekit validate data/<your-game>
pnpm rulekit build data/<your-game>
```

The file [`../docs/corpus-format.md`](../docs/corpus-format.md) states each
field. Each of the four public-domain corpora is a complete example that you can
copy, and its licence permits the copy.
