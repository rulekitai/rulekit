---
name: rulings_lookup
requires-tool: list_rulings
description: Use when the reader asks how something works in a specific situation, asks what happens when two things meet, asks about a published ruling or FAQ answer, or asks about event policy such as registration, penalties, or conduct.
---

# Reading a ruling

A ruling is not a rule. A rule is the published text. A ruling explains what
that text means in one case.

That difference decides how you answer. Quote a rule and cite it. Quote a
ruling, cite it, and also quote the rules the ruling names.

## The order

1. Call `list_rulings`. Pass the piece's name, or the topic, or the words the
   reader used.
2. Read the `rule_numbers` on every ruling you intend to use.
3. Call `get_rule` for those numbers, in ONE step where the tool takes a list.
4. Answer. Quote the ruling. Quote the rule under it. Cite both.

**Never quote a ruling without reading the rules it names.** A ruling states one
conclusion from a long argument. The argument is what makes the conclusion
correct. A reader who sees the conclusion alone cannot check it, and you cannot
check it either.

## Say where it came from

Every ruling carries `source_name` and `is_official`. Report both.

| `is_official` | What to write |
|---|---|
| true | Name the publisher. This is the publisher's official statement about the case. |
| false | Say the ruling is unofficial, and name who wrote it. |

An unofficial ruling is one person's interpretation of the rules. It is worth
having, and it can be wrong. A reader who is told an unofficial ruling is
official cannot judge how far to trust it, and that reader has no way to detect
the error.

## The three kinds

| `kind` | It answers | Watch for |
|---|---|---|
| `card` | A question about nameable pieces | Name every piece the ruling covers |
| `general` | A question about a mechanic or a timing | Say which mechanic |
| `policy` | Running an event, not playing a game | Never mix it with a game rule |

**Keep a policy ruling apart from a game rule.** An event's organiser decides
registration, penalties, and conduct. The rulebook decides a game rule. An
answer that mixes the two tells a reader that a tournament rule applies to a
home game, or that a rulebook decides a penalty.

## When a ruling disagrees with a rule

Report both, and name each source. Do not merge them into one confident
sentence, and do not choose one source without telling the reader.

The rules text is the stronger source. A ruling can be out of date, because the
rules can change after a person writes the ruling. Its `effective_date` states
when somebody wrote it.

## A withdrawn ruling

A ruling can be withdrawn. It then carries `is_deprecated`, and usually a note.
Do not answer a current question with a withdrawn ruling. When the reader asks
about that ruling by name, say that somebody withdrew it. Say what replaced it,
when the tools give you that.

## When the tools return nothing

Say that the rulings data holds nothing on the question. That is a complete
answer. Then answer from the rules themselves, when the rules cover the
question. Say plainly that you read the rules, and that you quote no ruling.
