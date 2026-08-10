# @rulekitai/pipeline

The answer pipeline: stages, cache, gate, and credentials.

Part of [rulekit](https://github.com/rulekitai/rulekit), a rules assistant that answers from your own
rulebook, quotes it, and gives the source of each claim.

## Install

```bash
pnpm add @rulekitai/pipeline
```

## Use

```ts
import { createPipeline } from "@rulekitai/pipeline/pipeline"
import { staticAnswersStage } from "@rulekitai/pipeline/stages/static"
import { glossaryStage } from "@rulekitai/pipeline/stages/glossary"

const pipeline = createPipeline({
  store, profile,
  stages: [staticAnswersStage(store), glossaryStage(store)],
})
```

The pipeline uses the first stage that can answer. Each free stage reads rows,
so it costs no model call.

## Documentation

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one.

The example corpora in the repository carry their own terms, and this package
contains none of them.
