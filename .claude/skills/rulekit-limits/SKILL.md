---
name: rulekit-limits
description: Add quotas, billing, or a caller's own model key to a rulekit endpoint, by writing a Gate and a credential resolver. Covers what an answer costs, why the price can be null, and how to keep the cost off the wire. Use when the user wants to rate-limit rules questions, charge for them, count usage per user, let callers bring their own model key, or asks how to stop one person spending their whole model budget.
---

# Add limits

rulekit ships **no pricing model**. Before it answers, the server asks one
question: is this caller allowed? The shipped answer is always yes.

Replace that answer by writing one object. **Nothing inside the packages
changes.**

## Step 1: decide who the caller is

```ts
createAskHandler({
  pipeline,
  agent,
  gate,
  identify: (request) => ({ id: readUserId(request) }),
})
```

`identify` runs first. Return `undefined` for a reader who has not signed in,
and let the gate decide what an unknown caller may do.

## Step 2: write the two methods

```ts
const gate: Gate = {
  async allow(ctx) {
    const used = await countToday(ctx.caller?.id)
    return used < 20
      ? { allow: true }
      : { allow: false, reason: "That is your 20 questions for today.",
          status: 429, retryAfterSeconds: 3600 }
  },
  async record(ctx, answer) {
    await recordUsage(ctx.caller?.id, answer.usage)
  },
}
```

**`allow` runs before every stage, so a refusal costs nothing.** It runs before
the cache and before the free stages, not only before the model.

**`record` runs after, with the full answer.** It sees which stage answered, so
a free answer need not count against a quota.

**Criterion:** the twenty-first question in a day returns 429 with a reason, and
the browser never receives a price.

## Step 3: read what an answer cost

`answer.usage` carries the counts, and the price when a provider reports one:

```ts
{ prompt_tokens: 39663, completion_tokens: 930, cost_usd: 0.0886,
  cache_read_input_tokens: 0, agent_steps: 5 }
```

**`cost_usd` comes from the provider, never from a table here.** A gateway that
already priced the call reports it. A provider that reports nothing leaves it
null.

**Null is not zero.** A zero reads as a genuinely free answer and pulls any
average you compute downwards. If the provider reports no price, price the
tokens in `record`. This project ships no price table, because a table of
per-model prices goes stale in silence.

## Step 4: let callers bring their own key

Four resolvers ship. `fromEnv`, `fromHeader`, and `firstOf` are in
`@rulekitai/pipeline/gate`. `fromDeviceLogin` is in `@rulekitai/pipeline/oauth`.

| Resolver | Reads the key from |
|---|---|
| `fromEnv(variable)` | The server's environment. Defaults to `AI_GATEWAY_API_KEY`. |
| `fromHeader(header)` | A request header. Defaults to `x-model-key`. |
| `fromDeviceLogin(...)` | An OAuth device sign-in that you configure. |
| `firstOf(...resolvers)` | The first resolver that returns a key. |

```ts
firstOf(fromHeader(), fromEnv())   // the caller's key, else the server's
```

With `fromHeader`, the caller pays their own provider. The quota question then
becomes rate limiting, and not cost control.

## Cheapest first

Most questions never reach a model. Rule lookups, ban checks, and glossary
definitions read from the corpus in a few milliseconds.

**Charge for what the model answers, not for what the corpus answers.** Read
which stage produced the answer in `record`, and count only the model turns.

## Completion criterion

All three are true:

- A caller over the limit gets a refusal with a reason and a retry time.
- A refusal costs no model call.
- Usage is recorded per caller, and the price is either the provider's figure
  or the app's own.
