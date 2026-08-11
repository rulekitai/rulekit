"use client"

import { type ReactNode, useCallback, useMemo } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cardUrlTransform, isCardPath } from "./card-url.ts"
import { useRuleKit } from "./provider.tsx"
import { TokenText } from "./token-text.tsx"

/**
 * One answer, rendered.
 *
 * Two things make this more than a plain Markdown block. A card is written as a
 * link with its own URL scheme, and this is where that becomes a preview. And
 * every run of text passes through the token renderer, so a game's symbols
 * appear wherever they were written, including inside a heading or a quote.
 *
 * WHAT IS ALLOWED THROUGH IS A CLOSED LIST. A model writes this text, and a
 * corpus supplies the paths inside it. Neither is trusted input, so a link is
 * rendered only when its scheme is one this file recognises, and a card link
 * only when its path is a plain relative one. See `card-url.ts` for both checks.
 */

/** Schemes a link may use. Everything else renders as plain text. */
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"])

/** Read a URL without throwing on the many strings that are not one. */
function parseUrl(href: string): URL | null {
  try {
    return new URL(href)
  } catch {
    return null
  }
}

/**
 * Walk a React child tree and apply the token renderer to every string.
 *
 * The key is the running character offset, not the position in the array. An
 * answer streams in, so the array grows and its items shift; the offset of a run
 * of text within the block does not, which is what makes it a stable identity
 * rather than a number that happens to be unique this render.
 */
function withTokens(children: ReactNode): ReactNode {
  if (typeof children === "string") return <TokenText>{children}</TokenText>
  if (!Array.isArray(children)) return children

  let offset = 0
  return children.map((child) => {
    if (typeof child !== "string") {
      // A non-string child carries a key of react-markdown's own.
      offset += 1
      return child
    }
    const at = offset
    offset += child.length
    return <TokenText key={`t${at}`}>{child}</TokenText>
  })
}

export function AnswerMarkdown(props: { children: string }): ReactNode {
  const { renderers, cardScheme, cardImageUrl } = useRuleKit()

  const components = useMemo(
    () => ({
      p: ({ children }: { children?: ReactNode }) => <p>{withTokens(children)}</p>,
      li: ({ children }: { children?: ReactNode }) => <li>{withTokens(children)}</li>,
      strong: ({ children }: { children?: ReactNode }) => <strong>{withTokens(children)}</strong>,
      em: ({ children }: { children?: ReactNode }) => <em>{withTokens(children)}</em>,
      h1: ({ children }: { children?: ReactNode }) => <h3>{withTokens(children)}</h3>,
      h2: ({ children }: { children?: ReactNode }) => <h3>{withTokens(children)}</h3>,
      h3: ({ children }: { children?: ReactNode }) => <h3>{withTokens(children)}</h3>,
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote className="rk-quote">{children}</blockquote>
      ),

      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        const raw = href ?? ""
        const name = typeof children === "string" ? children : String(children ?? "")

        // A card link. The path is relative and means nothing until a host app
        // says where images live, so an app that supplied no renderer and no
        // URL builder gets the card's name as plain text.
        if (cardScheme && raw.startsWith(`${cardScheme}:`)) {
          const path = raw.slice(cardScheme.length + 1)
          // A path that is not a plain relative one is not a card. See
          // `isCardPath`: the host app's builder is handed this, and a host that
          // returns it unchanged would build whatever the path says.
          if (!isCardPath(path)) return <>{withTokens(children)}</>
          if (renderers.card) return <>{renderers.card({ name, path, inline: false })}</>
          if (!cardImageUrl) return <>{withTokens(children)}</>
          return (
            <a className="rk-card-link" href={cardImageUrl(path)} target="_blank" rel="noreferrer noopener">
              {withTokens(children)}
            </a>
          )
        }

        const url = parseUrl(raw)
        // A scheme this file does not know renders as text. That covers
        // `javascript:` and `data:`, and every scheme nobody has thought of yet.
        if (!url || !SAFE_SCHEMES.has(url.protocol)) return <>{withTokens(children)}</>
        return (
          <a href={url.toString()} target="_blank" rel="noreferrer noopener">
            {withTokens(children)}
          </a>
        )
      },

      img: ({ src, alt }: { src?: string; alt?: string }) => {
        const raw = src ?? ""
        const name = alt ?? ""
        if (cardScheme && raw.startsWith(`${cardScheme}:`)) {
          const path = raw.slice(cardScheme.length + 1)
          if (!isCardPath(path)) return null
          if (renderers.card) return <>{renderers.card({ name, path, inline: true })}</>
          if (!cardImageUrl) return null
          // A plain <img>, deliberately. A framework's image component would
          // make this package depend on that framework.
          return <img className="rk-card-image" src={cardImageUrl(path)} alt={name} loading="lazy" />
        }
        // An answer must not be able to make the reader's browser fetch an
        // arbitrary address. Only the card scheme renders an image at all.
        return null
      },
    }),
    [renderers, cardScheme, cardImageUrl],
  )

  // Without this the card branch above is unreachable. react-markdown blanks a
  // URL whose scheme it does not know before a component ever sees it, and
  // `card:` is not a scheme it knows.
  const urlTransform = useCallback((url: string) => cardUrlTransform(url, cardScheme), [cardScheme])

  return (
    <div className="rk-answer">
      <Markdown remarkPlugins={[remarkGfm]} components={components} urlTransform={urlTransform}>
        {props.children}
      </Markdown>
    </div>
  )
}
