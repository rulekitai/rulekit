# Write `rulings.json`

Read this when the game has rulings to record. A corpus without them leaves the
file out.

```json
{
  "id": "rul-001",
  "kind": "card",
  "question": "Does Guard force an attack to be blocked?",
  "answer": "No. Guard makes the unit eligible to block, and the defender still chooses.",
  "cards": [{ "id": "pk-001", "name": "Stonewall Sentry" }],
  "rule_numbers": ["300.2", "800.1"],
  "topic": "blocking",
  "source_name": "Paper Kingdoms Rules Team",
  "is_official": true,
  "effective_date": "2026-03-01"
}
```

## The three kinds

`kind` carries the authority of the ruling, so each value reaches a different
reader.

| `kind` | It answers | `cards` |
|---|---|---|
| `card` | A question about nameable pieces | At least one. Required |
| `general` | A mechanic or a timing, naming no piece | Empty |
| `policy` | Running an event: registration, penalties, conduct | Usually empty |

**Spell `kind` exactly.** A value outside the three drops the row and reports
it, and this is the one field the loader refuses to guess. A misspelt `card`
ruling filed as `general` sits where no card lookup reaches it, and nothing
downstream notices.

## What `rulekit validate` checks

- Every `cards[].id` names a real card.
- Every `cards[].name` agrees with the card that its id names. The id resolving
  is not enough: the answer prints the NAME.
- No two rulings share an id. A citation carries the id.
- Every entry in `rule_numbers` names a real rule.
- A `card` ruling names at least one card. One that names none can never be
  found by a card lookup.
- `source_url`, when set, is an `https` address.

## Which questions answer with no model call

| The reader asks | What answers |
|---|---|
| `rulings for Stonewall Sentry` | The free stage |
| `Stonewall Sentry faq` | The free stage |
| The `question` field, word for word | The free stage |
| Any other phrasing | The agent. It costs a model call |

The first two are a lookup: the word "rulings" or "faq", plus a piece the corpus
knows. The third is an exact match, folded for case, spacing, accents, and a
final question mark. Nothing else matches, because a ruling that merely
resembles the question is the wrong answer.

**Write `question` as the reader would type it.** It is the phrasing they read
on the publisher's page, and the one phrasing that costs nothing.

**Set `source_url` beside `source_name`.** The answer prints the name as a link
to it, which is what a licence such as CC BY-SA asks for.

## Mark the authority honestly

`is_official` defaults to false. Set it true only when the game's publisher
wrote the ruling. Most rulings anybody can collect are somebody's careful
reading, and a reader told an unofficial ruling is official cannot weigh it.

The `chess` corpus marks all six of its rulings unofficial, because a real game
has a governing body that did not approve them. The `demo` corpus marks seven of
nine official, because its game is invented and this project publishes it.

## Completion criterion

- `rulekit validate <dir>` prints `Valid.` with the rulings in place.
- `rulekit ask <dir> "rulings for <a piece>"` prints them, and reports
  `served by static`, which proves the answer cost no model call.
- `rulekit ask <dir> "<the question field of one ruling>"` reports
  `served by static` too.
