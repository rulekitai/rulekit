# Working in this repository

rulekit answers rules questions from a corpus of JSON files, and gives the
source of every claim. It invents nothing. When the corpus holds no answer, the
assistant says so.

## Skills

`.claude/skills/` holds eight skills. Read `rulekit` first. It sends you to the
correct one of the other seven.

| Skill | It covers |
|---|---|
| `rulekit` | Reads the ground, then routes to one of the others |
| `rulekit-serve` | Get the packages, and mount the ask endpoint |
| `rulekit-interface` | The three interface levels, and card links |
| `rulekit-corpus` | Write a corpus and a profile for another game |
| `rulekit-references` | Let the agent read sites outside the corpus |
| `rulekit-extend` | Add a tool or a procedure of your own |
| `rulekit-limits` | Quotas, billing, and a caller's own model key |
| `rulekit-verify` | Prove that the answers invent nothing |

## Facts that save the most time

1. **Two packages are on npm under `@rulekitai/`.** `rulekit` holds the corpus,
   the agent, the pipeline, the HTTP handler, and the command. `ui` holds the
   React parts. Neither has a root export, so import a subpath. Install them, or
   work in this repository. A release goes out from a version tag, and
   `CONTRIBUTING.md` states how.
2. **Five corpora already exist**, so check before you write one: `riftbound`,
   `chess`, `texas-holdem`, `estate-line`, and `demo`. Four of the five carry a
   CC0 1.0 dedication and travel inside the npm package, where `rulekit init
   <dir> --corpus <name>` copies one. `riftbound` is Riot Games' property,
   permits non-commercial use only, and stays in this repository.
3. **`corpus.db` is not in version control.** The command `rulekit build <dir>`
   writes it from the JSON beside it. The CLI needs no such file, because it
   builds one in memory. A server does need it.
4. **The profile drives what the model reads about a card.**
   `cards.textFields` names each text box. `cards.statFields` explains a printed
   value whose name does not. `cards.noun` is what the game calls one piece, so
   chess tools say "piece" and never "card".
5. **"Cards" means the pieces a player can name**, and not only trading cards.
   Chess lists its six pieces there. Poker lists the 52 cards of the pack. A
   card fixes only its identity. Its text and its printed values go in two maps
   that the game names.
6. **A key with no value must be absent.** The loader drops `null` and `""`.
7. **A tool is offered only when the corpus can answer with it.** A game with an
   empty `banlist.json` never gets a banned-list tool. A procedure states the
   tool it needs in `requiresTool`, and the agent drops it when that tool is
   absent.
8. **Write a tool with `defineTool`, and never as a plain object.** It infers
   `execute`'s input from the Zod schema, and it checks the name.
   `assertUniqueToolNames` then throws for a repeated name: a custom tool named
   `get_rule` used to remove the built-in one in silence.
9. **A ruling is not a rule, and not an erratum.** A rule is the published text.
   An erratum changes that text. A ruling reads the unchanged text and says what
   it means in one case, so it carries a question and an answer. `rulings.json`
   holds all three kinds: `card`, `general`, and `policy`. It is the ONE
   collection file a corpus may leave out.
10. **rulekit ships no reference sites, and endorses none.** An implementer names
   their own on `createRulesAgent({ references })`, which is a runtime option and
   never a corpus file: a copied corpus must not grant a server network access.
   An answer that reads one says so, and marks the claim as outside the corpus.
11. **Both packages list their TypeScript source under a `rulekit-source` export
   condition.** The scripts here pass `--conditions=rulekit-source` and skip the
   compile step. Never rename it to `development` or `production`: Vite matches
   both by itself, and then loads raw TypeScript out of `node_modules` in every
   application that installs these packages.
12. **Run `pnpm build` once after `pnpm install`.** Every import points at
   compiled output, and a fresh clone holds none, so `next build` in the example
   fails with a missing module until you do.

## Commands

```bash
pnpm rulekit validate <dir>    # names each problem it finds
pnpm rulekit build <dir>       # writes corpus.db
pnpm rulekit ask <dir> "..."   # free stages only. A rule number or a keyword.
                               # It never calls the agent, so a question of any
                               # other shape reports a miss. Use the example app
                               # to reach the agent. Add --json for a script.
pnpm rulekit eval <dir>        # checks that answers invent nothing. Needs a key.

pnpm lint && pnpm check-types && pnpm test     # every unit test, no model, no network
pnpm test:e2e                                  # the interface, in a browser
```

Use Node 22.5 or newer. The Eve template in `templates/` needs Node 24.

## Rules for changes here

- **Run `pnpm rulekit validate` after each change to a corpus.** It names each
  problem.
- **Rebuild the database after each change to the JSON.** A stale database
  answers with old rules, and reports no error.
- **Put the free stages before the agent.** They answer a rule lookup, a
  legality question, and a keyword definition in a few milliseconds, with no
  model. Remove them, and every question costs a model call.
- **State the reason in a comment when the reason is not obvious.** The comments
  here explain decisions. Match that.
- **Add a test for each fix.** The test states what the fix prevents.
