# Design decisions

**The corpus is a file.** Node includes SQLite and its full-text search. You run
no database and compile no native module, so no installation step can fail. A
rule lookup reads a disk. It cannot be slow, and it cannot be down.

**This project collects no data.** It holds no importer, no scraper, and no
parser, and it fetches nothing. A corpus is an input in a documented shape, and
you decide how to make one. This keeps other people's page layouts, rate limits,
and terms out of the repository.

**There is no pricing model.** Before the server answers, it asks one question:
is this caller allowed? The shipped answer is always yes. To add quotas or
billing, write one object, the `Gate` interface. You change nothing inside these
packages.

**No model provider is required.** The model is one `"provider/model"` string,
so you change provider with one environment variable.

**You add a game with one file.** Rules that hold for every rulebook are built
in. A `profile.json` holds the rest: what the game is, what it calls things, and
how it writes its symbols. You write a profile, not a prompt.

**The free stages come before the agent.** A rule lookup, a legality question,
and a keyword definition are row reads, not reasoning jobs. Each takes a few
milliseconds and cannot be creatively wrong. Remove them and every question
costs a model call.

**A tool is offered only when the corpus can answer with it.** A game with an
empty banned list is never given a banned-list tool. A tool that can answer
nothing costs a step and teaches the model that these tools return nothing.
