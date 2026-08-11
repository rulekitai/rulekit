import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { createElement } from "react"
import { textOf } from "./children-text.ts"

describe("the name a card link carries", () => {
  test("a bare label is its own text", () => {
    assert.equal(textOf("Vi"), "Vi")
  })

  test("reads through emphasis, which a model writes often", () => {
    // `String(children)` on this produced "[object Object]", and a host app
    // then looked up a card by that name and found nothing.
    assert.equal(textOf(createElement("strong", null, "Vi")), "Vi")
    assert.equal(textOf(createElement("em", null, "Vi")), "Vi")
  })

  test("joins a label that is part plain and part emphasised", () => {
    assert.equal(
      textOf(["Vi, the ", createElement("em", { key: "a" }, "Piltover"), " Enforcer"]),
      "Vi, the Piltover Enforcer",
    )
  })

  test("reads through more than one level", () => {
    assert.equal(textOf(createElement("strong", null, createElement("em", null, "Vi"))), "Vi")
  })

  test("a number is text, because a card can be named one", () => {
    assert.equal(textOf(7), "7")
  })

  test("anything that renders nothing contributes nothing", () => {
    assert.equal(textOf(null), "")
    assert.equal(textOf(undefined), "")
    assert.equal(textOf(true), "")
    assert.equal(textOf(["Vi", null, undefined]), "Vi")
  })
})
