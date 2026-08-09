# data

The MIT licence at the root of this repository covers the code in `packages/`,
`templates/`, and `examples/`. The MIT grant does not cover the contents of this
directory. They are game reference data.

This statement sets the scope of the licence. It does not give attribution.

A licence file at the root of a repository reads as though it covers everything
beside it. This project cannot license a corpus that is not its own. So the
statement is here.

## What is here

| Directory | What it holds |
|---|---|
| `demo/` | A small invented game. The tests read this one, so no test depends on a real corpus. |
| `riftbound/` | A corpus for the Riftbound trading card game. |

## Make your own

A corpus is an input. This project holds no importer, no scraper, and no parser,
and it fetches nothing. Write the JSON in the way you prefer. Then run these two
commands:

```bash
pnpm rulekit validate data/<your-game>
pnpm rulekit build data/<your-game>
```

`docs/corpus-format.md` states each field. `demo/` is a complete example that
you can copy.
