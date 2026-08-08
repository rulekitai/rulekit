"use client"

import { Fragment, type ReactNode } from "react"
import { useRuleKit } from "./provider.tsx"

/**
 * Bracket tokens inside a line of text.
 *
 * A rules answer writes a game's symbols as `[Fury]`, `[2]` or `[Shield 2]`,
 * because a model can type those reliably and a symbol font cannot be relied on.
 * This turns them into whatever the host app renders, and into plain text when
 * the host renders nothing.
 *
 * A game with no symbols passes no renderer, and every bracket in its answers
 * stays exactly as written. That matters: a rulebook uses square brackets in
 * ordinary prose too.
 *
 * GIVE THIS PARSED TEXT, NOT RAW MARKDOWN. A link's label looks exactly like a
 * token, so `[Card Name](card:...)` would render the label as a symbol. In the
 * answer renderer that never happens, because react-markdown turns a link into
 * an element first and only its bare label reaches here.
 */

/** `[Fury]`, `[2]`, `[Shield 2]`. Bounded so a long bracketed aside is left alone. */
const TOKEN = /\[([A-Za-z][A-Za-z' -]{0,20}|\d{1,2})(?:\s+(\d{1,3}))?\]/g

export function TokenText(props: { children: string }): ReactNode {
  const { renderers } = useRuleKit()
  const text = props.children ?? ""
  if (!renderers.token || !text.includes("[")) return text

  const parts: ReactNode[] = []
  let last = 0
  let key = 0
  // The regular expression is global, so its index is reset before every run.
  // A shared global expression keeps state between calls and would skip tokens.
  TOKEN.lastIndex = 0
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0
    if (at > last) parts.push(text.slice(last, at))
    const rendered = renderers.token({
      raw: match[0],
      label: match[1] ?? "",
      value: match[2] ?? null,
    })
    // A renderer that returns nothing for a token it does not know leaves the
    // text as written, rather than deleting something the answer meant to say.
    parts.push(<Fragment key={key++}>{rendered ?? match[0]}</Fragment>)
    last = at + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}
