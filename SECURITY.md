# Security

## How to report a problem

**Do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting on this repository: open the
**Security** tab, then select **Report a vulnerability**. Only the maintainers
see that report.

If that path does not work for you, send an email to **rulekitai@gmail.com**.

State these three things:

- What an attacker can do.
- The steps that reproduce the behaviour.
- The version or the commit that you tested.

You get a first answer within seven days. This is a small project, and one
person maintains it, so please allow that much time.

## What this project defends

rulekit reads a corpus of JSON files and answers questions from it. It runs no
code from a corpus, and it writes to no file at run time. It opens one network
connection, to the model. The security surface is therefore small. These five
parts of it are real:

**The permission check.** The `Gate` interface runs before every stage, so a
refusal reads nothing. Report a fault that lets a caller pass the gate, or that
reads a quota for the wrong caller.

**The credentials.** The model key arrives in an environment variable. Report a
fault that writes a key to a log, to an answer, or to an event that reaches a
browser. The token counts and the price of an answer stay on the server, and the
browser never receives them.

**The answer as it reaches a browser.** An answer is Markdown, and the interface
renders it. A corpus author, or a model, can write text that makes the interface
run a script. Report a fault of that kind.

**The corpus as an input.** A corpus can hold text that tries to change the
instructions of the model. The assistant states the source of each claim, so a
reader can check an answer against the corpus. Report a fault that lets corpus
text remove the grounding rules, or that lets an answer reach a tool that its
profile does not permit.

**A reference site, when an operator names one.** rulekit ships no site, and it
reads none until an operator sets `references` on `createRulesAgent`. The model
then chooses an address, so rulekit treats every address as untrusted input.
Nine rules hold, and each one has a test:
[`docs/reference-sites.md`](docs/reference-sites.md) lists them. The rules that
matter most here allow `https` only, allow a listed host or its subdomain only,
and check a redirect before following it once.

Report a fault that reads an address outside the allowlist. A redirect that
reaches an address inside the operator's own network is the failure of this kind
that costs the most.

## What is not a security problem

**A wrong answer is a bug, and not a vulnerability.** Open a public issue for
it. The command `rulekit eval` measures invented rule numbers and invented
quotations, and [`docs/verifying-answers.md`](docs/verifying-answers.md) states
the method.

**A corpus that you supply is yours.** This project trusts the corpus that an
operator gives it, in the same way that a program trusts its own configuration
file. Do not serve a corpus that you did not write or read.

**The cost of a model call is an operator decision.** This project sets no limit
on the steps in one turn. Write a `Gate`, and set `stepCap`, to control what a
caller can spend.

## Supported versions

The latest version on npm is the supported version, and `main` is where a fix
lands first. This project publishes every package from a tag, through npm
trusted publishing, so each release carries a provenance attestation that links
it to the commit and the workflow that built it.
