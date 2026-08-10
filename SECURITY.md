# Security

## How to report a problem

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository: open the
**Security** tab, then select **Report a vulnerability**. Only the maintainers
see that report.

If that path does not work for you, send an email to **rulekitai@gmail.com**.

Please state:

- What an attacker can do.
- The steps that reproduce the behaviour.
- The version or the commit that you tested.

You get a first answer within seven days. This is a small project, and one
person maintains it, so please allow that much time.

## What this project defends

rulekit reads a corpus of JSON files and answers questions from it. It runs no
code from a corpus, it opens no network connection of its own, and it writes to
no file at run time. The security surface is therefore small. These parts of it
are real:

**The permission check.** The `Gate` interface runs before every stage, so a
refusal reads nothing. A fault that lets a caller pass the gate, or that reads
a quota for the wrong caller, is a security problem.

**The credentials.** The model key arrives in an environment variable. A fault
that writes a key to a log, to an answer, or to an event that reaches a browser
is a security problem. The token counts and the price of an answer stay on the
server, and the browser never receives them.

**The answer as it reaches a browser.** An answer is Markdown, and the
interface renders it. A corpus author, or a model, can write text that makes
the interface run a script. A fault of that kind is a security problem.

**The corpus as an input.** A corpus can hold text that tries to change the
instructions of the model. The assistant states the source of each claim, so a
reader can check an answer against the corpus. Report a fault that lets corpus
text remove the grounding rules, or that lets an answer reach a tool that its
profile does not permit.

## What is not a security problem

**A wrong answer is a bug, not a vulnerability.** Open a public issue for it.
The command `rulekit eval` measures invented rule numbers and invented
quotations, and
[`docs/verifying-answers.md`](docs/verifying-answers.md) states the method.

**A corpus that you supply is yours.** This project trusts the corpus that an
operator gives it, in the same way that a program trusts its own configuration
file. Do not serve a corpus that you did not write or read.

**The cost of a model call is an operator decision.** This project sets no
limit on the steps in one turn. Write a `Gate`, and set `stepCap`, to control
what a caller can spend.

## Supported versions

This project publishes no package to npm and cuts no releases yet. The `main`
branch is the supported version. A fix lands on `main`.
