import assert from "node:assert/strict"
import { describe, test } from "node:test"
import type { TraceStep } from "@rulekitai/rulekit/agent/events"
import {
  answerSource,
  type ChatMessage,
  classifyTurn,
  readSources,
  toHistory,
  toServedBy,
} from "./message.ts"
import { LocalChatStorage, NoChatStorage, titleFrom } from "./storage.ts"

const message = (over: Partial<ChatMessage>): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  text: "hello",
  ...over,
})

describe("whether a model wrote the answer", () => {
  test("a free stage counts as the rules, so a notice can say so", () => {
    // The reader was told "Written by an AI" under answers that no model
    // touched, while the trace line above said the answer came from the rules
    // data. A host app tests this to write a notice that stays true.
    for (const stage of ["static", "glossary"]) assert.equal(answerSource(stage), "rules")
  })

  test("the agent counts as a model", () => {
    for (const stage of ["agent", "cheap"]) assert.equal(answerSource(stage), "model")
  })

  test("a saved answer counts as the rules, because its own name is gone", () => {
    // A cached answer keeps no record of what wrote it first. "Checked against
    // the rules data" is true either way; "no model was involved" is not.
    assert.equal(answerSource("cache"), "rules")
    assert.equal(answerSource(undefined), "rules")
  })
})

describe("what counts as conversation", () => {
  test("keeps a real exchange", () => {
    const history = toHistory([
      message({ role: "user", text: "what is Guard" }),
      message({ role: "assistant", text: "Guard means ..." }),
    ])
    assert.deepEqual(history, [
      { role: "user", text: "what is Guard" },
      { role: "assistant", text: "Guard means ..." },
    ])
  })

  test("drops a turn nothing answered", () => {
    // Keeping it makes the NEXT question a follow-up, which skips every free
    // stage and goes straight to the model, carrying an apology as its context.
    const history = toHistory([
      message({ role: "user", text: "a question", transient: true }),
      message({ role: "assistant", text: "Request failed (500)", error: true }),
      message({ role: "user", text: "a real question" }),
    ])
    assert.deepEqual(history, [{ role: "user", text: "a real question" }])
  })

  test("drops a blank turn", () => {
    assert.deepEqual(toHistory([message({ text: "   " })]), [])
  })
})

describe("judging a completed turn", () => {
  test("a failure is both failed and transient", () => {
    assert.deepEqual(classifyTurn({ ok: false, body: {} }), { failed: true, transient: true })
    assert.deepEqual(classifyTurn({ ok: true, body: { error: "nope" } }), { failed: true, transient: true })
  })

  test("a success with no text is not an answer", () => {
    // A 200 with an empty body would otherwise be saved as a real turn and come
    // back as context for the next question.
    assert.deepEqual(classifyTurn({ ok: true, body: { text: "  " } }), { failed: false, transient: true })
  })

  test("a real answer is kept", () => {
    assert.deepEqual(classifyTurn({ ok: true, body: { text: "an answer" } }), {
      failed: false,
      transient: false,
    })
  })
})

describe("narrowing a value off the wire", () => {
  test("accepts a stage it knows and refuses anything else", () => {
    assert.equal(toServedBy("agent"), "agent")
    assert.equal(toServedBy("static"), "static")
    assert.equal(toServedBy("something-else"), undefined)
    assert.equal(toServedBy(42), undefined)
  })
})

describe("the sources an answer read outside the rules data", () => {
  const step = (over: Partial<TraceStep>): TraceStep => ({
    id: crypto.randomUUID(),
    tool: "search_all",
    label: "Searched the rules",
    kind: "searched",
    status: "completed",
    ...over,
  })
  const site = (name: string, url: string) => ({ name, url, official: false })

  test("finds nothing for an ordinary answer", () => {
    assert.deepEqual(readSources([step({}), step({})]), [])
    assert.deepEqual(readSources(undefined), [])
  })

  test("names a site a step read", () => {
    const source = site("Example FAQ", "https://faq.example.com/a")
    assert.deepEqual(readSources([step({}), step({ tool: "fetch_reference", source })]), [source])
  })

  test("names one site once, however many of its pages were read", () => {
    // A reader wants to know which sites were consulted. Three pages of one
    // site is still one source to weigh, and listing it three times reads as
    // three independent sources agreeing.
    const found = readSources([
      step({ source: site("Example FAQ", "https://faq.example.com/a") }),
      step({ source: site("Example FAQ", "https://faq.example.com/b") }),
      step({ source: site("Other FAQ", "https://other.example.com/c") }),
    ])
    assert.deepEqual(
      found.map((s) => s.name),
      ["Example FAQ", "Other FAQ"],
    )
  })
})

describe("conversation storage", () => {
  /** A minimal local-storage stand-in, so this runs with no browser. */
  function withLocalStorage(): void {
    const store = new Map<string, string>()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    }
  }

  test("titles a conversation from the first question", () => {
    assert.equal(titleFrom([message({ role: "user", text: "what is Guard" })]), "what is Guard")
    assert.equal(titleFrom([]), "New chat")
    assert.equal(titleFrom([message({ text: "x".repeat(100) })]).length, 58)
  })

  test("saves, reads, renames, and removes", async () => {
    withLocalStorage()
    const storage = new LocalChatStorage({ key: `test:${crypto.randomUUID()}` })
    await storage.save({ id: "a", title: "First", updatedAt: 1, messages: [message({ text: "hi" })] })
    assert.equal((await storage.list()).length, 1)
    assert.equal((await storage.read("a"))?.title, "First")
    await storage.rename("a", "Renamed")
    assert.equal((await storage.read("a"))?.title, "Renamed")
    await storage.remove("a")
    assert.equal(await storage.read("a"), null)
  })

  test("lists the most recent conversation first", async () => {
    withLocalStorage()
    const storage = new LocalChatStorage({ key: `test:${crypto.randomUUID()}` })
    await storage.save({ id: "old", title: "Old", updatedAt: 1, messages: [] })
    await storage.save({ id: "new", title: "New", updatedAt: 2, messages: [] })
    assert.deepEqual(
      (await storage.list()).map((s) => s.id),
      ["new", "old"],
    )
  })

  test("bounds itself so a browser cannot fill its storage", async () => {
    withLocalStorage()
    const storage = new LocalChatStorage({ key: `test:${crypto.randomUUID()}`, maxSessions: 2 })
    for (let i = 0; i < 5; i++)
      await storage.save({ id: `s${i}`, title: `t${i}`, updatedAt: i, messages: [] })
    assert.equal((await storage.list()).length, 2)
  })

  test("survives storage holding something it cannot read", async () => {
    withLocalStorage()
    const key = `test:${crypto.randomUUID()}`
    ;(globalThis as { localStorage: { setItem(k: string, v: string): void } }).localStorage.setItem(
      key,
      "not json",
    )
    const storage = new LocalChatStorage({ key })
    // An unreadable history must never stop somebody asking a new question.
    assert.deepEqual(await storage.list(), [])
  })

  test("the storage that keeps nothing satisfies the same interface", async () => {
    const storage = new NoChatStorage()
    await storage.save({ id: "a", title: "t", updatedAt: 1, messages: [] })
    assert.deepEqual(await storage.list(), [])
    assert.equal(await storage.read("a"), null)
  })
})
