# Verify that the assistant invents nothing

The design rests on one claim: every answer comes from the corpus. The command
`rulekit eval` asks a list of test questions, then examines each answer for two
faults. No model judges either fault. Both checks compare text against the
corpus.

```bash
pnpm rulekit eval data/riftbound
```

## The two faults

- **The answer invented a rule number.** Every rule number in an answer must
  exist in the corpus. A wrong rule number in a confident sentence looks the
  same as a correct one.
- **The answer invented a quotation.** Every quoted passage must exist in the
  corpus. Invented words under a correct rule number are the same untruth, and
  they carry a source.

Either fault gives a non-zero exit code, so a script can stop a deployment.

**A run that stops early is a failure.** A question with no answer names no rule
and quotes nothing, so each check on its content passes. Count those answers as
clean, and a failed run looks like a perfect score.

The command also reports how many of the expected rules an answer gave. That
number is information only, and it never fails a run. An answer can give four of
seven expected rules and still be correct.

## The command reads no reference site

An application may name websites that the agent reads when the corpus holds no
answer. See [reference sites](reference-sites.md). This command builds an agent
with none, and it offers no flag to add one. Two reasons, and both concern what
the two checks measure:

1. Both checks compare an answer against the CORPUS. A page from a website holds
   no corpus rule number and no corpus text. A correct answer that quoted one
   would therefore be reported as a fabrication.
2. A live page makes the run different every time. A site edits a sentence, and
   the same model, the same corpus, and the same questions then score
   differently. This command exists to remove that variation.

A clean run says that the corpus grounding holds. It says nothing about the
assistant with reference sites switched on. Check that by hand.

## When to run the command

The command needs a model key, and it takes approximately ten minutes. Run it
when you select a model, and when you change the instructions. Do not run it for
each push.

```
--model <id>     The model to grade. The default is anthropic/claude-sonnet-5.
--out <file>     Write the full results as JSON.
--only <text>    Run only the questions whose id or category contains this text.
--step-cap <n>   Limit the model calls for each question. The default is none.
--regrade <file> Grade the answers of an earlier run again, with no model calls.
```

## The measured result

This project measured `anthropic/claude-sonnet-5` against the Riftbound corpus
in this repository. 12 of the 18 questions ran before the model key reached its
spending limit. 11 answers were clean. One answer invented rule `315.1.b.1`,
which does not exist. The corpus holds rule `315.1.b`. No answer invented a
quotation.

The same question invented the same rule against an earlier copy of the corpus.
This is a repeatable weakness of this model with this rulebook, and not a single
event. That weakness is the reason for this command.
