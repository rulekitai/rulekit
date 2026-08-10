"use client"

import { useState } from "react"
import type { ChatSummary } from "./storage.ts"

/**
 * The saved conversations.
 *
 * Where they are saved is not this component's business. It is given a list and
 * three callbacks, so it works the same over the browser's own storage and over
 * a server that keeps conversations for a signed-in reader.
 */
export function ChatSessionList(props: {
  sessions: ChatSummary[]
  currentId: string | null
  onOpen: (id: string | null) => void
  onRemove?: (id: string) => void
  onRename?: (id: string, title: string) => void
}) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [draft, setDraft] = useState("")

  const commit = (id: string) => {
    const title = draft.trim()
    setRenaming(null)
    if (title) props.onRename?.(id, title)
  }

  return (
    <nav className="rk-sessions" aria-label="Saved conversations">
      <button type="button" className="rk-session-new" onClick={() => props.onOpen(null)}>
        New chat
      </button>
      <ul className="rk-session-list">
        {props.sessions.map((session) => (
          <li key={session.id} data-current={session.id === props.currentId ? "true" : undefined}>
            {renaming === session.id ? (
              <input
                className="rk-session-rename"
                value={draft}
                aria-label="Conversation title"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => commit(session.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commit(session.id)
                  // Escape abandons the edit. Without it the only way out of a
                  // rename is to commit one.
                  if (event.key === "Escape") setRenaming(null)
                }}
              />
            ) : (
              <>
                <button type="button" className="rk-session-open" onClick={() => props.onOpen(session.id)}>
                  {session.title}
                </button>
                {props.onRename ? (
                  <button
                    type="button"
                    className="rk-session-action"
                    aria-label={`Rename ${session.title}`}
                    onClick={() => {
                      setDraft(session.title)
                      setRenaming(session.id)
                    }}
                  >
                    Rename
                  </button>
                ) : null}
                {props.onRemove ? (
                  <button
                    type="button"
                    className="rk-session-action"
                    aria-label={`Delete ${session.title}`}
                    onClick={() => props.onRemove?.(session.id)}
                  >
                    Delete
                  </button>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
    </nav>
  )
}
