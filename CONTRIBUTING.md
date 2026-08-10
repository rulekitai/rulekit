# Contributing to rulekit

Thank you for your interest. This page states how to build the project, what
the checks expect, and how to send a change.

## Before you start

Use Node 22 or a later version, and use pnpm. The Eve template in
`templates/eve-agent` needs Node 24.

```bash
git clone https://github.com/rulekitai/rulekit.git
cd rulekit
pnpm install
```

The tests need no model key and no network.

## The checks

Run these four commands before you open a pull request. The continuous
integration workflow runs the same four, so a green run here means a green run
there.

```bash
pnpm lint                        # Biome
pnpm check-types                 # TypeScript, every package
pnpm test                        # 284 tests, no model and no network
pnpm rulekit validate data/demo  # the corpus the tests read
```

Two more commands are available. `pnpm test:e2e` drives the interface in a
browser. `pnpm rulekit eval <corpus>` measures whether the answers invent
anything, and it needs a model key. Read
[`docs/verifying-answers.md`](docs/verifying-answers.md) before you run it.

## How to send a change

1. Make a fork of the repository, and make a branch in your fork.
2. Write the change and a test for it.
3. Run the four checks above.
4. Open a pull request against `main`.

You do not need write access. Every change arrives as a pull request from a
fork, and a maintainer merges it.

## What a good change looks like

**Add a test for each fix.** The test states what the fix prevents. A fix with
no test invites the same fault again.

**State the reason in a comment when the reason is not obvious.** The comments
in this repository explain decisions, and not syntax. Match that.

**Keep the free stages before the agent.** A rule lookup, a legality question,
and a keyword definition are row reads. Each takes a few milliseconds. If you
move that work to the agent, every question costs one model call.

**Write a comment that a semi-technical reader understands in one pass.** Name
what a thing does, in place of the name of a library internal.

## If you change a corpus

Run `pnpm rulekit validate <dir>` after each change. It names each problem it
finds.

Then run `pnpm rulekit build <dir>`. A database that you do not rebuild answers
with the old rules, and it reports no error.

The file [`docs/corpus-format.md`](docs/corpus-format.md) states every field.
The file [`docs/adding-a-game.md`](docs/adding-a-game.md) covers a new game from
the first file to the finished profile.

## If you add a game

New corpora are welcome. Two conditions apply:

1. **You must own the words, or the words must be in the public domain.** Do
   not copy a rulebook, a PDF file, or a web page. The rules of a game are a
   system, and nobody owns a system. An author owns a particular set of words.
2. **State the terms.** Put a `LICENSE` file and a `NOTICE.txt` file in the
   corpus directory, as the five corpora in `data/` do.

## Commit messages

Write an imperative subject with no full stop at the end, and no more than 72
characters. Follow the style that the repository already uses:

```
fix(cli): say why a free-stage question missed, and what shape works
```

Use the body to state the problem first, and then the change. A reader of the
log wants to know why the commit exists.

## Reporting a problem

Open an issue. The forms ask for the corpus, the question, the answer you
received, and the answer you expected. Those four facts reproduce almost every
problem in this project.

For a security problem, read [`SECURITY.md`](SECURITY.md) instead. Do not open
a public issue for it.

## The licence of your contribution

This project uses the Apache License 2.0. When you send a pull request, you
agree that your contribution carries that licence. A corpus that you add
carries the licence that you state in its own directory.
