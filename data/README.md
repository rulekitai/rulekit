# data

The MIT licence at the root of this repository covers the code under
`packages/`, `templates/`, and `examples/`. The contents of this directory are
game reference data and are outside that grant.

This is a scope line, not an attribution. It exists because a licence file at
the root of a repository reads as covering everything beside it, and a corpus is
not the project's to license.

## What is here

| Directory | What it is |
|---|---|
| `demo/` | A small invented game. The tests and the continuous-integration workflow read this one, so nothing in the test suite depends on a real corpus. |
| `riftbound/` | A built corpus for the Riftbound trading card game. |

## Producing your own

A corpus is an input. This project ships no importer, no scraper, and no parser,
and it never fetches anything. Write the JSON however you like, then:

```bash
pnpm rulekit validate data/<your-game>
pnpm rulekit build data/<your-game>
```

`docs/corpus-format.md` states the shape field by field. `demo/` is a complete
worked example you can copy.
