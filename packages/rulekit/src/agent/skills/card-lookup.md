---
name: card_lookup
requires-tool: search_cards
description: Use when the reader names a card, asks what a card does, asks whether a card may be played, or asks how two cards interact.
---

# Reading a card

A card question needs two calls. `search_cards` gives you the id. `get_cards`
gives you the printed text. Never answer a card question from the search result
alone. That result carries the name and the type, and no text that supports a
ruling.

## The order

1. Call `search_cards` with the name the reader typed.
2. Read the matches. Choose the card the reader means. See the ambiguity rules
   below.
3. Call `get_cards` with the id, or with the ids.
4. Quote the text you got back. Link the card by name.

## More than one card

**Pass every id to ONE `get_cards` call.** Two cards in one call cost one step.
Two calls cost two steps, and a turn holds few of them. An interaction question
is one call.

## An ambiguous name

A name can match several printed cards. Three cases, and three answers:

- **Several printings of the same character or title.** Read them all in one
  call. Say which printing your answer covers, and name the others. A reader who
  types a bare character name means every card that carries it, and an answer
  about one printing reads as an answer about all of them.
- **Several different cards.** Do not guess. Name what you found, and ask which
  card the reader means.
- **Nothing found.** Say that the card data holds no such card. Do not answer
  from memory. Do not offer a card with a similar name.

## Text sits in more than one box

A card prints text in more than one box. The card's own box is only the first
box. An equipment card, or an attachment card, commonly prints almost nothing
there, and prints everything it does in another box.

**Read every text field `get_cards` returns before you state that a card does
not say something.** "This card has no such text" is a claim, and one field does
not support it.

## Legality is not text

The card's text does not state whether a player may play the card. The banned
and restricted list states that. The card changes hold a change to the printed
text.

- "What does this card do?" → `get_cards`.
- "Can I play this card?" → `list_banlist`.
- "Was this card changed?" → `list_errata`.

A question that asks two of these needs two lookups. Answer both parts, and cite
each part separately.
