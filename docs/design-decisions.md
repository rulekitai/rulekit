# Design decisions

**The corpus is a file.** Node includes SQLite and its full-text search. You run
no database, and you compile no native module, so no installation step can fail.
A rule lookup reads a disk. It is always fast, and it is always available.

**This project collects no data.** It holds no importer, no scraper, and no
parser. A corpus is an input in a documented format, and you decide how to make
one. This keeps other people's page layouts, rate limits, and terms out of this
repository.

**A ruling is its own collection.** A rule is the published text. An erratum
changes that text. A ruling reads the unchanged text and says what it means in
one case. The third carries a question and an answer, and the first two carry
statements. A ruling therefore needs its own shape, its own ranking, and its own
tool. One file holds all three kinds: a ruling about named pieces, a ruling
about a mechanic, and a ruling about running an event. They differ in authority,
and not in shape, and a reader must be able to separate them.

**`rulings.json` is the one collection file that may be absent.** Every other
missing file fails the load, because "this list is empty" and "I forgot this
file" must look different. Rulings arrived after people had written the first
corpora. A necessary `rulings.json` would stop every one of them loading. The
cost of that exception is one check: `rulekit validate` names any JSON file that
the format does not know, so a misspelt name is still loud.

**A reference site is a runtime option, and this project ships none.** You may
name websites that the agent reads when the corpus holds no answer.
[Reference sites](reference-sites.md) is the guide. The list lives on the agent
for three reasons:

- It is not a corpus field. A copied corpus must never grant a server outbound
  network access that the server did not ask for.
- It is not in `data/`. A site list shipped here would make this project the
  publisher and the endorser of that list, and this project endorses none.
- It is not an `extraTools` entry. The `references` option adds an instruction
  block as well as the two tools. The tools without that block produce an answer
  that cites a website as though it were the rules.

**An outside claim is marked on the trace, and not inside the answer text.** The
tool that read the page writes the site, the address, and the official flag onto
its trace step. The interface renders that step. A mark inside the answer text
comes from the model, and the model is the thing that the reader checks.

**`rulekit eval` cannot read a reference site.** Both of its checks compare an
answer against the corpus. A live page also makes the same run score differently
from day to day. See [verifying answers](verifying-answers.md). There is no flag
to override this. The sites belong to an application, and a command-line switch
would put that decision in the wrong hands.

**This project ships no pricing model and no limit.** The server asks one
question before it answers: does this caller have permission? The default gate
always answers yes. To add a quota or a payment, write one `Gate` object. You
change nothing inside these packages.

**No single model provider is required.** The model is one `"provider/model"`
text string, so one environment variable changes the provider.

**One file adds a game.** The rules that apply to every rulebook are part of the
code. A `profile.json` file holds the rest: the name of the game, the words it
uses, and the way it writes its symbols. You write a profile, and you do not
write a prompt.

**The free stages run before the agent.** A rule lookup, a legality question,
and a keyword definition are row reads. Each one takes a few milliseconds, and
none of them can invent an answer. Remove these stages, and every question costs
one model call.

**The agent offers a tool only when the corpus can answer with it.** A game with
an empty banned list gets no banned-list tool. A tool that can answer nothing
costs one step, and it teaches the model that these tools return nothing.
