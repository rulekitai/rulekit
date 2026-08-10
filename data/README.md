# data

**rulekit works with any rulebook.** It holds no knowledge of any particular
game, and it reads whichever corpus you point it at. The directories here are
examples, and one of them is the shape the format is documented against.

Each corpus carries its own terms, because each one comes from somewhere
different. Read the table before you copy anything.

| Directory | What it holds | Terms |
|---|---|---|
| `demo/` | An invented game, Paper Kingdoms, written for this project | **CC0 1.0.** Public domain. Copy it freely. |
| `riftbound/` | Reference data for the Riftbound trading card game | **Riot Games' property.** No rights granted. See below. |

The tests read `demo/`, so no test depends on data this project does not own.

## The Apache licence does not cover this directory

The `LICENSE` file at the root of this repository covers the code in
`packages/`, `templates/`, and `examples/`. It does not cover game data.

A licence file at the root of a repository reads as though it covers everything
beside it. This project cannot license a corpus that is not its own, so this
statement sets the boundary.

## Riftbound

The data in `riftbound/` is the property of Riot Games, Inc.

rulekit was created under Riot Games' "Legal Jibber Jabber" policy using assets
owned by Riot Games. Riot Games does not endorse or sponsor this project.

**That policy permits non-commercial community use only.** To use rulekit in a
commercial product, supply your own corpus. `demo/` is public domain and works
as a starting point.

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

`docs/corpus-format.md` states each field. `demo/` is a complete example that
you can copy, and its licence lets you.
