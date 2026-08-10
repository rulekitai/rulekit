"use client"

import { useAskStream } from "@rulekit/react/use-ask-stream"
import { useChatSessions } from "@rulekit/react/use-chat-sessions"
import { Chat } from "@rulekit/ui/chat"
import { ChatSessionList } from "@rulekit/ui/chat-session-list"
import { RuleKitProvider } from "@rulekit/ui/provider"
import { type ReactNode, useCallback, useEffect, useState } from "react"

/**
 * The chat screen.
 *
 * Two hooks and two components. The conversation is kept in the browser, so
 * this example needs no login and no database, and a person who clones the
 * repository has a working chat with history the moment it starts.
 */

export function AskScreen(props: {
  title: string
  subtitle: string
  cardScheme: string
  suggestions: string[]
  /** Shown under the conversation. A corpus whose data belongs to somebody else needs one. */
  legalNote?: ReactNode
}) {
  const sessions = useChatSessions()
  const [notice, setNotice] = useState<string | null>(null)

  const { messages, setMessages, loading, streaming, ask } = useAskStream({
    endpoint: "/api/ask",
    persistTurn: async (chatId, transcript, newTurn) => {
      await sessions.persistTurn(chatId, transcript, newTurn)
    },
    onError: (error) => {
      // A reader who has scrolled up sees nothing of the inline failure, so the
      // notice is repeated where the input is.
      setNotice(
        error.status === 0
          ? "No connection. Check your network and ask again."
          : error.retryAfterSeconds
            ? `${error.message} Try again in ${error.retryAfterSeconds} seconds.`
            : error.message,
      )
    },
  })

  const onAsk = useCallback(
    (question: string) => {
      setNotice(null)
      // The conversation the question was asked in, captured now. Opening
      // another one mid-answer must not save this answer into that one.
      void ask(question, sessions.currentId)
    },
    [ask, sessions.currentId],
  )

  const openChat = useCallback(
    async (id: string | null) => {
      setNotice(null)
      setMessages(await sessions.open(id))
    },
    [sessions, setMessages],
  )

  // Clear the notice once an answer arrives, so a stale failure does not sit
  // above a conversation that has since recovered.
  useEffect(() => {
    if (streaming) setNotice(null)
  }, [streaming])

  return (
    <RuleKitProvider
      cardScheme={props.cardScheme}
      suggestions={props.suggestions}
      disclaimer="Written by an AI from the rules data. Check anything that decides a game."
      legalNote={props.legalNote}
    >
      <div className="app-shell">
        <aside className="app-sidebar">
          <div className="app-brand">rulekit</div>
          <ChatSessionList
            sessions={sessions.sessions}
            currentId={sessions.currentId}
            onOpen={openChat}
            onRemove={sessions.remove}
            onRename={sessions.rename}
          />
        </aside>
        <main className="app-main">
          <Chat
            messages={messages}
            loading={loading}
            streaming={streaming}
            onAsk={onAsk}
            title={props.title}
            subtitle={props.subtitle}
            gateNotice={notice ? <div className="app-notice">{notice}</div> : null}
          />
        </main>
      </div>
    </RuleKitProvider>
  )
}
