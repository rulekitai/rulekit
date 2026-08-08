import type { ChatMessage } from "./message.ts"

/** One saved conversation. */
export type ChatSession = {
  id: string
  title: string
  updatedAt: number
  messages: ChatMessage[]
}

/** A conversation in the list, without its messages. */
export type ChatSummary = Omit<ChatSession, "messages">

/**
 * Somewhere to keep conversations.
 *
 * The default keeps them in the browser, which needs no account, no database,
 * and no server. That is what lets the example app be a real chat that a person
 * can clone and use.
 *
 * A fork that wants conversations to follow a reader between devices implements
 * this against its own backend. Nothing else changes.
 */
export interface ChatStorage {
  list(): Promise<ChatSummary[]>
  read(id: string): Promise<ChatSession | null>
  save(session: ChatSession): Promise<void>
  remove(id: string): Promise<void>
  rename(id: string, title: string): Promise<void>
}

const KEY = "rulekit:chats"

/** A title from the first thing a reader asked. */
export function titleFrom(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user" && m.text.trim())?.text.trim() ?? "New chat"
  return first.length > 60 ? `${first.slice(0, 57)}…` : first
}

/**
 * Conversations in the browser's local storage.
 *
 * Local storage is synchronous and shared by every tab, so the whole list is
 * read and written at once. That is fine for the tens of conversations a person
 * accumulates and wrong for thousands, which is what `maxSessions` bounds.
 */
export class LocalChatStorage implements ChatStorage {
  #key: string
  #max: number

  constructor(options: { key?: string; maxSessions?: number } = {}) {
    this.#key = options.key ?? KEY
    this.#max = Math.max(1, options.maxSessions ?? 100)
  }

  #readAll(): ChatSession[] {
    if (typeof localStorage === "undefined") return []
    try {
      const raw = localStorage.getItem(this.#key)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? (parsed as ChatSession[]) : []
    } catch {
      // Storage that is full, blocked, or holding something else entirely. An
      // unreadable history must not stop somebody asking a new question.
      return []
    }
  }

  #writeAll(sessions: ChatSession[]): void {
    if (typeof localStorage === "undefined") return
    const trimmed = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, this.#max)
    try {
      localStorage.setItem(this.#key, JSON.stringify(trimmed))
    } catch {
      // Quota exceeded, or storage disabled. Losing the history is bad; losing
      // the answer on screen because saving it threw would be worse.
      console.warn("[rulekit] could not save the conversation history")
    }
  }

  async list(): Promise<ChatSummary[]> {
    return this.#readAll()
      .map(({ messages: _messages, ...rest }) => rest)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async read(id: string): Promise<ChatSession | null> {
    return this.#readAll().find((s) => s.id === id) ?? null
  }

  async save(session: ChatSession): Promise<void> {
    const all = this.#readAll().filter((s) => s.id !== session.id)
    this.#writeAll([...all, session])
  }

  async remove(id: string): Promise<void> {
    this.#writeAll(this.#readAll().filter((s) => s.id !== id))
  }

  async rename(id: string, title: string): Promise<void> {
    this.#writeAll(this.#readAll().map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s)))
  }
}

/** Storage that keeps nothing. For a deployment that must not retain anything. */
export class NoChatStorage implements ChatStorage {
  async list(): Promise<ChatSummary[]> {
    return []
  }
  async read(): Promise<ChatSession | null> {
    return null
  }
  async save(): Promise<void> {}
  async remove(): Promise<void> {}
  async rename(): Promise<void> {}
}
