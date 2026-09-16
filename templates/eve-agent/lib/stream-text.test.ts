import assert from "node:assert/strict"
import test from "node:test"
import { appendMessageDelta } from "./stream-text.ts"

test("appends only the delta from message.appended events", () => {
  let text = appendMessageDelta("", { messageDelta: "Hel" })
  text = appendMessageDelta(text, { messageDelta: "lo" })

  assert.equal(text, "Hello")
  assert.equal(appendMessageDelta(text, {}), "Hello")
})
