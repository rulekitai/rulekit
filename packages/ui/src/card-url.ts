import { defaultUrlTransform } from "react-markdown"

/**
 * The two checks that decide whether a card link is rendered at all.
 *
 * They live in a plain module rather than beside the component because both are
 * string handling, both are where a mistake becomes a hole, and neither needs
 * React to be tested.
 */

/**
 * Let the card scheme through, and hand every other URL to the Markdown
 * renderer's own check.
 *
 * The renderer blanks a URL whose scheme it does not recognise, and `card:` is
 * not one it recognises. So without this the card branch of the answer renderer
 * never runs at all: every card link arrives with an empty address and renders
 * as plain text, and every card image renders as nothing.
 *
 * Delegating the rest is the load-bearing half. It is what keeps `javascript:`
 * and `data:` blocked, and it keeps this file from having to know the full list
 * of schemes a browser treats as code.
 */
export function cardUrlTransform(url: string, cardScheme: string): string {
  return cardScheme && url.startsWith(`${cardScheme}:`) ? url : defaultUrlTransform(url)
}

/**
 * Is this a relative path to an image, and nothing else?
 *
 * Everything after `card:` is handed to the host app's own address builder, and
 * a host app that returns the path as it arrived builds whatever the path says.
 * A model writes the answer and a corpus supplies the path, so neither is
 * trusted. Two shapes have to be refused:
 *
 * - A path carrying its own scheme. `card:javascript:alert(1)` would otherwise
 *   become a link that runs code when a reader clicks it.
 * - A path opening with two slashes. `card://example.com/x.png` names another
 *   site, and a reader who clicks a card would leave for it.
 *
 * A control character is refused for the same reason a browser strips one: it
 * is how `java\nscript:` is written to get past a check like this one.
 */
export function isCardPath(path: string): boolean {
  if (!path || path.startsWith("//")) return false
  if (path.includes(":") || path.includes("\\")) return false
  for (const character of path) {
    const code = character.codePointAt(0) ?? 0
    if (code <= 0x1f || code === 0x7f) return false
  }
  return true
}
