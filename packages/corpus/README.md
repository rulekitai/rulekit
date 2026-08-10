# @rulekitai/corpus

The rules corpus: a JSON schema, a SQLite builder, and one read interface.

Part of [rulekit](https://github.com/rulekitai/rulekit), a rules assistant that answers from your own
rulebook, quotes it, and gives the source of each claim.

## Install

```bash
pnpm add @rulekitai/corpus
```

## Use

```ts
import { SqliteStore } from "@rulekitai/corpus/sqlite-store"

const store = SqliteStore.open("my-game/corpus.db")
const rule = await store.getRuleByNumber("300.2.a")
```

Build the database first with `rulekit build <dir>` from `@rulekitai/cli`.

## Documentation

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one.

The example corpora in the repository carry their own terms, and this package
contains none of them.
