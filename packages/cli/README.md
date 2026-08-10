# @rulekitai/cli

The rulekit command: validate, build, init, and ask.

Part of [rulekit](https://github.com/rulekitai/rulekit), a rules assistant that answers from your own
rulebook, quotes it, and gives the source of each claim.

## Install

```bash
pnpm add @rulekitai/cli
```

## Use

```bash
npx @rulekitai/cli validate my-game   # names every problem
npx @rulekitai/cli build my-game      # writes my-game/corpus.db
npx @rulekitai/cli ask my-game "what is <a keyword>"
npx @rulekitai/cli eval my-game       # needs a model key
```

The `ask` command runs the free stages only, so it answers a rule number and a
keyword. It does not call the agent.

## Documentation

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one.

The example corpora in the repository carry their own terms, and this package
contains none of them.
