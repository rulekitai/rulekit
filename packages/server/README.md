# @rulekitai/server

One web-standard HTTP handler that mounts anywhere.

Part of [rulekit](https://github.com/rulekitai/rulekit), a rules assistant that answers from your own
rulebook, quotes it, and gives the source of each claim.

## Install

```bash
pnpm add @rulekitai/server
```

## Use

```ts
import { createAskHandler } from "@rulekitai/server/handler"

export const POST = createAskHandler({ pipeline, agent })
```

The handler is a plain function from `Request` to `Response`, so the same
export works in Next.js, Hono, Bun, Deno, and a Cloudflare Worker.

## Documentation

- [The corpus format](https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md)
- [Adding a game](https://github.com/rulekitai/rulekit/blob/main/docs/adding-a-game.md)
- [Architecture](https://github.com/rulekitai/rulekit/blob/main/docs/architecture.md)

## Licence

Apache 2.0. See the `LICENSE` file beside this one.

The example corpora in the repository carry their own terms, and this package
contains none of them.
