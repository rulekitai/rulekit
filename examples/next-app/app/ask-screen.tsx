"use client"

import { Chat } from "@rulekitai/ui/chat"
import { ChatSessionList } from "@rulekitai/ui/chat-session-list"
import { answerSource, type ReadSource } from "@rulekitai/ui/message"
import { RuleKitProvider } from "@rulekitai/ui/provider"
import { useAskStream } from "@rulekitai/ui/use-ask-stream"
import { useChatSessions } from "@rulekitai/ui/use-chat-sessions"
import { type ReactNode, useCallback, useEffect, useState } from "react"

/**
 * The chat screen.
 *
 * Two hooks and two components. The conversation is kept in the browser, so
 * this example needs no login and no database, and a person who clones the
 * repository has a working chat with history the moment it starts.
 */

/**
 * A card, drawn as its printed name.
 *
 * A corpus stores a relative image path and no pictures, because the pictures
 * belong to whoever owns the game. An app with no pictures still wants a reader
 * to see that the assistant matched a real card, so the name is marked and the
 * path is kept where somebody debugging can read it. An app that does host
 * pictures returns an `<img>` here instead, or passes `cardImageUrl` and no
 * renderer at all.
 */
function CardChip(card: { name: string; path: string; inline: boolean }) {
  return (
    <span className="app-card" title={card.path}>
      {card.name}
    </span>
  )
}

/**
 * A note under the answer that is true of that answer.
 *
 * Most questions here never reach a model: a rule number and a keyword are read
 * out of the rules data in a few milliseconds. Saying "Written by an AI" under
 * one of those told the reader the opposite of what happened, and it disagreed
 * with the trace line directly above it.
 */
function disclaimerFor(servedBy: string, sources: ReadSource[]): string {
  const base =
    answerSource(servedBy) === "model"
      ? "Written by an AI from the rules data. Check anything that decides a game."
      : "Read from the rules data, with no AI. Check anything that decides a game."
  // An answer that read somebody's website names it. The rules data is what
  // this project vouches for, and a reader cannot weigh a claim from anywhere
  // else unless they are told it came from there.
  if (!sources.length) return base
  const named = sources.map((s) => `${s.name}${s.official ? "" : " (unofficial)"}`).join(", ")
  return `${base} This answer also read ${named}, which is outside the rules data.`
}

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
      renderers={{ card: CardChip }}
      suggestions={props.suggestions}
      disclaimer={disclaimerFor}
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
