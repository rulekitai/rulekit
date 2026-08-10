# data

**rulekit works with any rulebook.** It holds no knowledge of any particular
game. It reads whichever corpus you point it at, and the directories here are
examples.

They are deliberately unalike. A card game, an abstract board game, a property
board game, and a betting card game read the same way, through the same format,
with no code change between them. That is the claim this directory exists to
prove.

| Directory | The game | Cards | Terms |
|---|---|---|---|
| `demo/` | An invented trading card game | Yes | **CC0 1.0.** Public domain. |
| `chess/` | Chess | No | **CC0 1.0.** Written for this project. |
| `estate-line/` | An invented property trading game | Yes, and they are not trading cards | **CC0 1.0.** Written for this project. |
| `texas-holdem/` | Texas Hold'em poker | No | **CC0 1.0.** Written for this project. |
| `riftbound/` | Riftbound trading card game | Yes | **Riot Games' property.** No rights granted. |

Four of the five carry no third-party rights at all. The tests read `demo/`, so
no test depends on data this project does not own.

**Every word in the four CC0 corpora is original.** This project copied no
rulebook, no PDF, and no web page to produce them. The rules of chess and of
poker are systems, and a system is not owned. A particular author's wording is
owned, so none is reused here.

## The Apache licence does not cover this directory

The `LICENSE` file at the root of this repository covers the code in
`packages/`, `templates/`, and `examples/`. It does not cover game data.

A licence file at the root of a repository reads as though it covers everything
beside it. This project cannot license a corpus that is not its own, so this
statement sets the boundary. Each corpus above states its own terms.

## Riftbound

The data in `riftbound/` is the property of Riot Games, Inc.

rulekit was created under Riot Games' "Legal Jibber Jabber" policy using assets
owned by Riot Games. Riot Games does not endorse or sponsor this project.

**That policy permits non-commercial community use only.** To use rulekit in a
commercial product, use one of the four public-domain corpora above, or supply
your own.

Riftbound and Riot Games are trademarks of Riot Games, Inc. This project names
them only to say which data it reads.

## Make your own

A corpus is an input. This project holds no importer, no scraper, and no parser,
and it fetches nothing. Write the JSON in the way you prefer. Then run these two
commands:

```bash
pnpm rulekit validate data/<your-game>
pnpm rulekit build data/<your-game>
```

`docs/corpus-format.md` states each field. Any of the four public-domain corpora
is a complete example that you can copy, and its licence lets you.
