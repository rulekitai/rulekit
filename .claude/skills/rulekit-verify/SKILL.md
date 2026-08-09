---
name: rulekit-verify
description: Prove a rulekit assistant invents nothing, by writing test questions and running rulekit eval before a release. Covers the two checks, why a run that stops early counts as a failure, and how to read the result. Use when the user asks whether the assistant makes things up, wants to test answer quality, compare two models, check for invented rule numbers or invented quotations, or add a rules-answer check to a release process.
---

# Prove it invents nothing

The whole design rests on one claim: every answer comes from the corpus.
`rulekit eval` is what checks the claim.

## What it checks

It asks a list of test questions, then checks each answer for two things the
assistant must never do:

- **It made up a rule number.** Every rule number in an answer must exist in
  the corpus. A confidently cited wrong rule reads exactly like a correct one.
- **It made up a quotation.** Every quoted passage must appear in the corpus. A
  real rule number wrapped around invented words is the same lie wearing a
  citation.

**No model judges either one.** Both are text matching against the corpus, so
the result does not drift and needs no calibration.

Either one exits non-zero, so a release script can refuse to ship.

## Step 1: write the questions

`<corpus>/eval.json` holds a list. Each entry:

```json
{ "id": "RL-01", "question": "how does Deflect interact with Shield",
  "category": "rule_lookup", "difficulty": "medium",
  "expected_rule_numbers": ["825.2", "827.4"],
  "rubric": "Names both keywords and cites the rule that defines each." }
```

**Ask the questions players actually ask.** Cover a rule lookup, a keyword, a
card interaction, a legality question, and one question the corpus cannot
answer. That last one checks that it says so instead of inventing.

`rubric` is read by nobody today. Write it anyway: it states what a good answer
looks like.

## Step 2: run it

```bash
pnpm rulekit eval <corpus>
pnpm rulekit eval <corpus> --model openai/gpt-5 --out result.json
pnpm rulekit eval <corpus> --regrade result.json    # no model calls
```

It needs a model key and takes about ten minutes. **Run it before adopting a
model or changing the instructions, not on every push.**

`--regrade` scores a saved run again with no model calls, so a change to the
checks costs nothing to test.

## Step 3: read the result

Three numbers print.

| Number | Meaning |
|---|---|
| Clean answers | How many invented nothing. **This is the one that matters.** |
| Invented rules and quotations | Each one fails the run. |
| Citation recall | Information only. It never fails a run. |

**Recall is not a score.** An answer can cite four of seven expected rules and
be completely right. A low recall against a stale question list means the list
drifted from the rulebook, not that the model failed. The command names the
expected rule numbers that no longer exist.

**A run that stops early counts as failing.** A question that produced no
answer cites nothing and quotes nothing, so every check on its content passes
it. Counting those as clean would let an outage read as a perfect score.

## What a failure means

One invented rule number is not noise. Ask the same question again: if the
model invents the same number, it is a repeatable weakness of that model on
that rulebook. Change the model, or add the missing data, or sharpen the
profile. Do not raise the threshold.

## Completion criterion

`rulekit eval <corpus>` exits zero, every question produced an answer, and the
result is recorded with the model it was measured on.
