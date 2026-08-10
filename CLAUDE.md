# Working in this repository

rulekit answers rules questions from a corpus of JSON files, and gives the
source of every claim. It invents nothing. When the corpus holds no answer, the
assistant says so.

## Skills

`.claude/skills/` holds six skills. Read `rulekit` first. It sends you to the
correct one of the other five.

| Skill | It covers |
|---|---|
| `rulekit` | Reads the ground, then routes to one of the others |
| `rulekit-serve` | Get the packages, and mount the ask endpoint |
| `rulekit-interface` | The three interface levels, and card links |
| `rulekit-corpus` | Write a corpus and a profile for another game |
| `rulekit-limits` | Quotas, billing, and a caller's own model key |
| `rulekit-verify` | Prove that the answers invent nothing |

## Facts that save the most time

1. **Nothing is published to npm.** Fork this repository, or copy `packages/`
   into another one.
2. **Five corpora already ship**, so check before writing one: `riftbound`,
   `chess`, `texas-holdem`, `estate-line`, and `demo`. Four of the five are
   public domain. `riftbound` is Riot Games' property and permits
   non-commercial use only.
3. **`corpus.db` is not in version control.** The command `rulekit build <dir>`
   writes it from the JSON beside it. The CLI does not need the file, because it
   builds one in memory. A server does need it.
4. **The profile drives what the model reads about a card.**
   `cards.textFields` names each text box, `cards.statFields` explains a printed
   value whose name does not, and `cards.noun` is what the game calls one piece,
   so chess tools say "piece" and never "card".
5. **"Cards" means the pieces a player can name**, not only trading cards.
   Chess lists its six pieces there. Poker lists the 52 cards of the pack. A
   card fixes only its identity, and its text and its printed values go in two
   maps that the game names.
6. **A key with no value must be absent.** The loader drops `null` and `""`.
7. **A tool is offered only when the corpus can answer with it.** A game with an
   empty `banlist.json` is never given a banned-list tool.

## Commands

```bash
pnpm rulekit validate <dir>    # names each problem it finds
pnpm rulekit build <dir>       # writes corpus.db
pnpm rulekit ask <dir> "..."   # free stages only. A rule number or a keyword.
                               # It never calls the agent, so a question of any
                               # other shape reports a miss. Use the example app
                               # to reach the agent.
pnpm rulekit eval <dir>        # checks that answers invent nothing. Needs a key.

pnpm lint && pnpm check-types && pnpm test     # 284 tests, no model, no network
pnpm test:e2e                                  # the interface, in a browser
```

Use Node 22 or newer. The Eve template in `templates/` needs Node 24.

## Rules for changes here

- **Run `pnpm rulekit validate` after each change to a corpus.** It names each
  problem.
- **Rebuild the database after each change to the JSON.** A stale database
  answers with old rules and reports no error.
- **Put the free stages before the agent.** They answer a rule lookup, a
  legality question, and a keyword definition in a few milliseconds, with no
  model. Remove them and every question costs a model call.
- **State the reason in a comment when the reason is not obvious.** The comments
  here explain decisions. Match that.
- **Add a test for each fix.** The test states what the fix prevents.
