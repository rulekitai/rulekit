"use client"

import { type ReactNode, useCallback, useEffect, useRef } from "react"
import { Composer } from "./composer.tsx"
import { EmptyState } from "./empty-state.tsx"
import type { ChatMessage } from "./message.ts"
import { MessageRow } from "./message-row.tsx"
import { useRuleKit } from "./provider.tsx"
import { ThinkingIndicator } from "./thinking-indicator.tsx"

/**
 * The whole chat screen.
 *
 * It renders what it is given and owns nothing but the scroll. The transport
 * lives in `useAskStream`, and the conversation list in `useChatSessions`, so a
 * host app can replace this component and keep both.
 */

export type ChatProps = {
  messages: ChatMessage[]
  loading: boolean
  streaming: boolean
  onAsk: (question: string) => void
  title?: string
  subtitle?: string
  /** Anything a fork wants above the input: a quota meter, an upgrade notice. */
  gateNotice?: ReactNode
}

export function Chat(props: ChatProps) {
  const { legalNote } = useRuleKit()
  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Follow a growing answer only while the reader is already at the bottom.
  // Scrolling somebody back down while they are reading an earlier message is
  // the single most irritating thing a chat can do.
  const onScroll = useCallback(() => {
    const node = scroller.current
    if (!node) return
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
  }, [])

  useEffect(() => {
    const node = scroller.current
    if (!node || !pinned.current) return
    node.scrollTop = node.scrollHeight
  }, [])

  const last = props.messages[props.messages.length - 1]
  const waiting = props.loading && (!last || last.role === "user")

  return (
    <div className="rk-chat">
      <div className="rk-scroller" ref={scroller} onScroll={onScroll}>
        <div className="rk-column">
          {props.messages.length === 0 ? (
            <EmptyState title={props.title} subtitle={props.subtitle} onPick={props.onAsk} />
          ) : (
            props.messages.map((message) => (
              <MessageRow key={message.id} message={message} streaming={props.streaming} />
            ))
          )}
          {waiting ? <ThinkingIndicator /> : null}
          {legalNote ? <div className="rk-legal">{legalNote}</div> : null}
        </div>
      </div>
      <div className="rk-footer">
        <div className="rk-column">
          {props.gateNotice}
          <Composer
            onSubmit={props.onAsk}
            // One question at a time. Without this a second question interleaves
            // into the first one's stream and both answers arrive scrambled.
            disabled={props.loading || props.streaming}
            autoFocus
          />
        </div>
      </div>
    </div>
  )
}
