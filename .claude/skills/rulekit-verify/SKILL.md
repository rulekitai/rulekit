---
name: rulekit-verify
description: Prove a rulekit assistant invents nothing, with `rulekit eval`. Use when the user asks whether the assistant makes things up, wants to compare two models on a corpus, or adds a rules-answer check to a release.
---

# Prove it invents nothing

`rulekit eval` checks one claim: every answer comes from the corpus.

## What it checks

It asks a list of test questions, then checks each answer for two kinds of
**fabrication**:

- **A fabricated rule number.** Every rule number in an answer must exist in the
  corpus. A confidently cited wrong rule reads exactly like a correct one.
- **A fabricated quotation.** Every quoted passage must appear in the corpus. An
  answer that cites a real rule and quotes words the corpus does not hold is a
  fabrication with a citation attached.

**Both checks match text against the corpus**, so
the result does not drift and needs no calibration.

Either kind exits non-zero, so a release script can refuse to ship.

## What it does NOT check

**`rulekit eval` reads no reference site, and no flag makes it.** It builds an
agent with none, on purpose. Two reasons:

1. Both checks compare an answer against the CORPUS. A page from somebody's
   website holds no corpus rule number and no corpus text, so a correct answer
   that quoted one would be graded a fabrication.
2. A live page makes the run different every time. A site edits its wording, and
   the same model, corpus, and questions then score differently, which is the
   drift this command exists to remove.

So a score here says the corpus grounding holds. It says nothing about the
assistant with reference sites switched on. Check that by hand, and see
`rulekit-references` for what a reader should be shown.

## Step 1: write the questions

`<corpus>/eval.json` holds a list. Each entry:

```json
{ "id": "RL-01", "question": "how does Deflect interact with Shield",
  "category": "rule_lookup", "difficulty": "medium",
  "expected_rule_numbers": ["825.2", "827.4"],
  "rubric": "Names both keywords and cites the rule that defines each." }
```

**Ask the questions players ask.** Cover a rule lookup, a keyword, a card
interaction, a legality question, and one question the corpus cannot answer.
That last one checks that the assistant says so.

`rubric` is read by nobody today. Write it anyway: it states what a good answer
looks like.

## Step 2: run it

```bash
npx rulekit eval <corpus>
npx rulekit eval <corpus> --model openai/gpt-5 --out result.json
npx rulekit eval <corpus> --regrade result.json    # no model calls
```

It needs a model key and takes about ten minutes. **Run it before you adopt a
model or change the instructions.**

`--regrade` scores a saved run again with no model calls, so a change to the
checks costs nothing to test.

## Step 3: read the result

The summary prints:

| Number | Meaning |
|---|---|
| Clean answers | How many invented nothing. **This is the one that matters.** |
| Fabricated rules and quotations | Each one fails the run. |
| Citation recall | Information only. It never fails a run. |

**Recall is not a score.** An answer can cite four of seven expected rules and
still be right. A low recall against a stale question list means the list
drifted from the rulebook. The command names the expected rule numbers that no
longer exist.

**A run that stops early counts as failing.** A question that produced no answer
cites nothing and quotes nothing, so every check on its content passes it.
Counting those as clean would let an outage read as a perfect score.

## What a failure means

One fabricated rule number is not noise. Ask the same question again: when the
model invents the same number, that is a repeatable weakness of the model on
that rulebook. Change the model, add the missing data, or sharpen the profile.
Keep the threshold where it is.

## Completion criterion

`rulekit eval <corpus>` exits zero, every question produced an answer, and the
result is recorded with the model it was measured on.
