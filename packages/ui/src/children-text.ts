import { isValidElement, type ReactNode } from "react"

/**
 * The plain text inside a rendered node.
 *
 * A card is written as a link, and a host app is handed the link's label as the
 * card's NAME: it looks the card up by that name, or prints it beside the
 * image. So the name has to be the printed one.
 *
 * A label is not always a bare string. A model writes `[**Vi**](card:...)` and
 * `[Vi, the *Piltover* Enforcer](card:...)` often enough, and the Markdown
 * renderer turns the emphasis into an element before this file sees it.
 * `String(children)` on that produces `[object Object]`, or, for a partly
 * emphasised name, `Vi, the ,[object Object], Enforcer`. Both reach a host app
 * as a name no card carries.
 */
export function textOf(node: ReactNode): string {
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  // Null, undefined, a boolean, and anything else render as nothing, so they
  // contribute nothing to the name either.
  return ""
}
