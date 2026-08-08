---
name: card_lookup
description: Use when the reader names a card, asks what a card does, asks whether a card may be played, or asks how two cards interact.
---

# Reading a card

A card question is two calls, not one. `search_cards` gives you the id.
`get_cards` gives you the printed text. Never answer a card question from the
search result alone: it carries the name and the type, and nothing a ruling can
rest on.

## The order

1. Call `search_cards` with the name the reader typed.
2. Read the matches. Pick the one they meant. See the ambiguity rules below.
3. Call `get_cards` with the id or ids.
4. Quote the text you got back. Link the card by name.

## More than one card

**Pass every id to ONE `get_cards` call.** Two cards in one call cost one step;
two calls cost two, and a turn has few to spend. An interaction question is one
call.

## An ambiguous name

A name can reach several printed cards. Three cases, three answers:

- **Several printings of the same character or title.** Read them all in one
  call. Say which printing your answer covers, and name the others. A reader who
  types a bare character name means every card that carries it, and an answer
  about one printing reads as an answer about all of them.
- **Several genuinely different cards.** Do not guess. Name what you found and
  ask which one they mean.
- **Nothing found.** Say the card is not in the card data. Do not fall back on
  memory, and do not offer a card with a similar name as though it were the one
  they asked for.

## Text lives in more than one box

A card can print text in more than one place. The card's own box is only the
first. Equipment and attachment cards commonly hold almost nothing in it, and
everything they do in another one.

**Read every text field `get_cards` returns before you conclude a card does not
say something.** "This card has no such text" is a claim, and reading one field
does not support it.

## Legality is not text

The card's text does not say whether it may be played. That lives in the banned
and restricted list, and a change to the printed text lives in the card changes.

- "What does this card do?" → `get_cards`.
- "Can I play this card?" → `list_banlist`.
- "Was this card changed?" → `list_errata`.

A question that asks two of these needs two lookups. Answer both halves, and
cite each one separately.
