# Check that the assistant invents nothing

The design rests on one claim: every answer comes from the corpus. `rulekit
eval` asks a list of test questions, then checks each answer for two faults. No
model judges either fault. Both are text matching against the corpus.

```bash
pnpm rulekit eval data/riftbound
```

## The two faults

- **The answer made up a rule number.** Each rule number in an answer must
  exist in the corpus. A wrong rule number, stated with confidence, reads
  exactly like a correct one.
- **The answer made up a quotation.** Each quoted passage must appear in the
  corpus. Invented words inside a real rule number are the same lie, with a
  source attached.

Either fault exits with a non-zero code, so a script can refuse to deploy.

The command also reports how many expected rules an answer gave. That figure is
information only, and it never fails a run: an answer can give four of seven
expected rules and still be correct.

**A run that stops early counts as a failure.** A question that gives no answer
names no rule and quotes nothing, so each check on its content passes. To count
those as clean lets a failed run read as a perfect score.

## When to run it

The command needs a model key and takes about ten minutes. Run it before you
adopt a model or change the instructions, not on each push. Add `--regrade
<file>` to score a previous run again, with no model calls.

```
--model <id>     Model to grade. Default anthropic/claude-sonnet-5.
--out <file>     Write full results as JSON.
--only <text>    Run only questions whose id or category contains this.
--step-cap <n>   Cap model calls per question. Default none, as in production.
--regrade <file> Grade a previous run's answers again, with no model calls.
```

## The measured result

**With `anthropic/claude-sonnet-5` on the Riftbound corpus that ships:** 12 of
18 questions ran before the model key reached its spending limit. 11 answers
were clean. One made up rule `315.1.b.1`, which does not exist, where `315.1.b`
does. No answer made up a quotation.

The same question made up the same rule against an earlier copy of the corpus.
So it is a repeatable weakness of this model on this rulebook, and not a single
event. That is why this command exists.
