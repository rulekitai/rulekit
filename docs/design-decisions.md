# Design decisions

**The corpus is a file.** Node includes SQLite and its full-text search. You run
no database and you compile no native module, so no installation step can fail.
A rule lookup reads a disk. It is always fast, and it is always available.

**This project collects no data.** It contains no importer, no scraper, and no
parser, and it fetches nothing. A corpus is an input in a documented format, and
you decide how to make one. This keeps the page layouts, the rate limits, and
the terms of other people out of this repository.

**This project has no price.** Before the server answers, it asks one question:
does this caller have permission? The answer in this repository is always yes.
To add a quota or a payment, write one object: the `Gate` interface. You change
nothing inside these packages.

**No model provider is necessary.** The model is one `"provider/model"` text
string, so you change the provider with one environment variable.

**One file adds a game.** The rules that apply to every rulebook are part of the
code. A `profile.json` file holds the rest: the name of the game, the words it
uses, and the way it writes its symbols. You write a profile, and you do not
write a prompt.

**The free stages run before the agent.** A rule lookup, a legality question,
and a keyword definition are row reads. Each one takes a few milliseconds, and
none of them can invent an answer. If you remove these stages, every question
costs one model call.

**The agent offers a tool only when the corpus can answer with it.** A game with
an empty banned list gets no banned-list tool. A tool that can answer nothing
costs one step, and it teaches the model that these tools return nothing.
