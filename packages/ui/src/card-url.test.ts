import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { defaultUrlTransform } from "react-markdown"
import { cardUrlTransform, isCardPath } from "./card-url.ts"

describe("letting a card link reach the renderer", () => {
  test("the Markdown renderer blanks a card link on its own", () => {
    // This is the reason cardUrlTransform exists. If this ever stops being
    // true, the transform is no longer load-bearing and can go.
    assert.equal(defaultUrlTransform("card:riftbound/SFD-167.webp"), "")
  })

  test("keeps a card link whole", () => {
    assert.equal(cardUrlTransform("card:riftbound/SFD-167.webp", "card"), "card:riftbound/SFD-167.webp")
  })

  test("uses the scheme the profile named, not the word card", () => {
    assert.equal(cardUrlTransform("piece:chess/rook.webp", "piece"), "piece:chess/rook.webp")
    assert.equal(cardUrlTransform("card:riftbound/SFD-167.webp", "piece"), "")
  })

  test("a game with no card scheme keeps the renderer's own check", () => {
    assert.equal(cardUrlTransform("card:riftbound/SFD-167.webp", ""), "")
  })

  test("still blanks a scheme that runs code", () => {
    assert.equal(cardUrlTransform("javascript:alert(1)", "card"), "")
    assert.equal(cardUrlTransform("data:text/html,<script>alert(1)</script>", "card"), "")
  })

  test("keeps an ordinary web link", () => {
    assert.equal(cardUrlTransform("https://example.com/x", "card"), "https://example.com/x")
    assert.equal(cardUrlTransform("/images/x.webp", "card"), "/images/x.webp")
  })
})

describe("what may be handed to a host app's address builder", () => {
  test("accepts a relative image path", () => {
    assert.equal(isCardPath("riftbound/SFD-167.webp"), true)
    assert.equal(isCardPath("SFD-167.webp"), true)
  })

  test("refuses a path carrying its own scheme", () => {
    // A host app whose builder returns the path as it arrived would otherwise
    // render a link that runs code when a reader clicks it.
    assert.equal(isCardPath("javascript:alert(1)"), false)
    assert.equal(isCardPath("data:text/html,x"), false)
    assert.equal(isCardPath("https://example.com/x.webp"), false)
  })

  test("refuses a path that names another site", () => {
    assert.equal(isCardPath("//example.com/x.webp"), false)
    assert.equal(isCardPath("\\\\example.com\\x.webp"), false)
  })

  test("refuses a path holding a control character", () => {
    // Built in code, so no source file has to carry an invisible byte. This is
    // how a scheme is written to get past a check that reads the text plainly.
    const nul = String.fromCharCode(0)
    const del = String.fromCharCode(0x7f)
    assert.equal(isCardPath(`java${nul}script:x`), false)
    assert.equal(isCardPath(`card${del}name.webp`), false)
  })

  test("refuses an empty path", () => {
    assert.equal(isCardPath(""), false)
  })
})
