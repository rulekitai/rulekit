"use client"

import { createContext, type ReactNode, useContext, useMemo } from "react"
import type { ReadSource } from "./message.ts"

/**
 * The slots that make this interface work for a game it was not written for.
 *
 * Everything game-specific in a rules answer is one of two things: a symbol
 * written as a bracket token, and a card written as a link. Neither can be built
 * in, because a game with no symbols and no cards must render plain text rather
 * than empty boxes.
 *
 * A host app passes what it has. Passing nothing is a complete configuration.
 */

/** Renders one bracket token, for example `[Fury]` or `[Shield 2]`. */
export type TokenRenderer = (token: { raw: string; label: string; value: string | null }) => ReactNode

/** Renders a card link, given the path from the answer's `card:` URL. */
export type CardRenderer = (card: { name: string; path: string; inline: boolean }) => ReactNode

export type RuleKitRenderers = {
  token?: TokenRenderer
  card?: CardRenderer
}

export type RuleKitConfig = {
  renderers: RuleKitRenderers
  /** The URL scheme a card link uses, without the colon. Must match the profile. */
  cardScheme: string
  /**
   * Turn a card image path into something a browser can load.
   *
   * A corpus stores a relative path, because it does not know where the images
   * will be served from. Nothing renders a card image until a host app says.
   */
  cardImageUrl?: (path: string) => string
  /**
   * Shown under every answer. Pass null to show nothing.
   *
   * PASS A FUNCTION WHEN THE TRUTH CHANGES WITH THE ANSWER. Most answers come
   * from the free stages, where no model runs at all, so one fixed sentence
   * saying "Written by an AI" states the opposite of what happened, directly
   * under a trace line that says the answer was read from the rules data. The
   * function receives the name of whatever served the answer — `static`,
   * `glossary`, `cache`, `agent` — and `answerSource` in
   * `@rulekitai/ui/message` turns that name into "rules" or "model" for you.
   *
   * The second argument names any site OUTSIDE the rules data that this answer
   * read, and is empty for almost every answer. When it is not empty, say so:
   * a reader weighs a claim from somebody's website differently from a rule,
   * and this is the only place a host app can tell them without trusting a
   * sentence the model chose to write.
   */
  disclaimer?: ReactNode | ((servedBy: string, sources: ReadSource[]) => ReactNode)
  /** Shown at the foot of the conversation. A host app's own notice goes here. */
  legalNote?: ReactNode
  /** Questions offered on an empty screen. */
  suggestions?: string[]
}

const DEFAULT: RuleKitConfig = {
  renderers: {},
  cardScheme: "card",
  suggestions: [],
}

const RuleKitContext = createContext<RuleKitConfig>(DEFAULT)

export function RuleKitProvider(props: { children: ReactNode } & Partial<RuleKitConfig>) {
  const { children, ...config } = props
  // Rebuilt only when a field really changes. A fresh object on every render
  // re-renders every message in the conversation on every keystroke.
  const value = useMemo<RuleKitConfig>(
    () => ({
      renderers: config.renderers ?? DEFAULT.renderers,
      cardScheme: config.cardScheme ?? DEFAULT.cardScheme,
      cardImageUrl: config.cardImageUrl,
      disclaimer: config.disclaimer,
      legalNote: config.legalNote,
      suggestions: config.suggestions ?? DEFAULT.suggestions,
    }),
    [
      config.renderers,
      config.cardScheme,
      config.cardImageUrl,
      config.disclaimer,
      config.legalNote,
      config.suggestions,
    ],
  )
  return <RuleKitContext.Provider value={value}>{children}</RuleKitContext.Provider>
}

export function useRuleKit(): RuleKitConfig {
  return useContext(RuleKitContext)
}
