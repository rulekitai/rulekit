"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { ChatMessage } from "./message.ts"
import {
  type ChatSession,
  type ChatStorage,
  type ChatSummary,
  LocalChatStorage,
  titleFrom,
} from "./storage.ts"

/**
 * The saved conversations, and the one on screen.
 *
 * The storage is injected, so the same hook drives a chat kept in the browser
 * and a chat kept on a server. Nothing here knows which it has.
 */
export type ChatSessions = {
  sessions: ChatSummary[]
  /** The conversation on screen, or null for a new one. */
  currentId: string | null
  loading: boolean
  open: (id: string | null) => Promise<ChatMessage[]>
  /** Save a turn. Creates the conversation on the first one, and returns its id. */
  persistTurn: (chatId: string | null, transcript: ChatMessage[], newTurn: ChatMessage[]) => Promise<string>
  remove: (id: string) => Promise<void>
  rename: (id: string, title: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useChatSessions(options: { storage?: ChatStorage } = {}): ChatSessions {
  // Built once. A new storage object on every render would restart every effect
  // below on every render.
  const storage = useMemo(() => options.storage ?? new LocalChatStorage(), [options.storage])
  const [sessions, setSessions] = useState<ChatSummary[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setSessions(await storage.list())
  }, [storage])

  useEffect(() => {
    let cancelled = false
    storage
      .list()
      .then((list) => {
        if (!cancelled) setSessions(list)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [storage])

  const open = useCallback(
    async (id: string | null): Promise<ChatMessage[]> => {
      setCurrentId(id)
      if (!id) return []
      const session = await storage.read(id)
      // An id that names nothing means a deleted or foreign conversation. Start
      // a new one rather than leaving the interface pointing at a ghost.
      if (!session) {
        setCurrentId(null)
        return []
      }
      return session.messages
    },
    [storage],
  )

  const persistTurn = useCallback(
    async (chatId: string | null, transcript: ChatMessage[], _newTurn: ChatMessage[]): Promise<string> => {
      // The id is the one the turn was ASKED in, captured when the reader hit
      // send, never read live. Without that, opening another conversation
      // mid-answer saves the answer into the wrong one.
      const id = chatId ?? crypto.randomUUID()
      const existing = chatId ? await storage.read(chatId) : null
      const session: ChatSession = {
        id,
        title: existing?.title ?? titleFrom(transcript),
        updatedAt: Date.now(),
        // Transient turns are dropped before saving. A question nothing answered
        // is not part of the conversation, and reloading a chat that kept one
        // would make the next question a follow-up with a blank turn as context.
        messages: transcript.filter((m) => !m.transient),
      }
      await storage.save(session)
      await refresh()
      // Adopt the new id only when the reader is still in the conversation the
      // turn belonged to.
      setCurrentId((current) => (current === chatId ? id : current))
      return id
    },
    [storage, refresh],
  )

  const remove = useCallback(
    async (id: string) => {
      await storage.remove(id)
      setCurrentId((current) => (current === id ? null : current))
      await refresh()
    },
    [storage, refresh],
  )

  const rename = useCallback(
    async (id: string, title: string) => {
      await storage.rename(id, title)
      await refresh()
    },
    [storage, refresh],
  )

  return { sessions, currentId, loading, open, persistTurn, remove, rename, refresh }
}
