import assert from "node:assert/strict"
import { describe, test } from "node:test"

/**
 * The bracket-token parser, tested as the string handling it is.
 *
 * The component itself needs React and a browser; the pattern it walks does not,
 * and the pattern is where the bugs live. The regular expression is copied here
 * from `token-text.tsx` and a test below asserts the two agree, so this file
 * cannot silently drift from what actually runs.
 */

/** Must match TOKEN in token-text.tsx. The test below enforces that. */
const TOKEN = /\[([A-Za-z][A-Za-z' -]{0,20}|\d{1,2})(?:\s+(\d{1,3}))?\]/g

/** Split text the way the component does: literal runs and token matches. */
function split(text: string): {
  literal: string[]
  tokens: { raw: string; label: string; value: string | null }[]
} {
  const literal: string[] = []
  const tokens: { raw: string; label: string; value: string | null }[] = []
  let last = 0
  // Reset before every walk. A shared global expression keeps its index between
  // calls and skips every second match, which is the bug this guards.
  TOKEN.lastIndex = 0
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0
    if (at > last) literal.push(text.slice(last, at))
    tokens.push({ raw: match[0], label: match[1] ?? "", value: match[2] ?? null })
    last = at + match[0].length
  }
  if (last < text.length) literal.push(text.slice(last))
  return { literal, tokens }
}

describe("recognising a token", () => {
  test("reads a keyword", () => {
    assert.deepEqual(split("has [Fury] on it").tokens, [{ raw: "[Fury]", label: "Fury", value: null }])
  })

  test("reads a cost written as a bare number", () => {
    assert.deepEqual(split("costs [2] to play").tokens, [{ raw: "[2]", label: "2", value: null }])
  })

  test("reads a keyword carrying a value", () => {
    assert.deepEqual(split("gains [Shield 2] now").tokens, [
      { raw: "[Shield 2]", label: "Shield", value: "2" },
    ])
  })

  test("finds every token, not every second one", () => {
    // A global regular expression keeps its index between calls. Without a reset
    // the second walk over the same text returns nothing.
    const text = "[1][Fury][Shield 2][Body]"
    assert.equal(split(text).tokens.length, 4)
    assert.equal(split(text).tokens.length, 4, "a second walk must find the same tokens")
  })

  test("keeps the text around a token", () => {
    const { literal } = split("pay [2] and gain [Shield 1] this turn")
    assert.deepEqual(literal, ["pay ", " and gain ", " this turn"])
  })
})

describe("leaving ordinary brackets alone", () => {
  test("ignores a bracketed aside longer than a token", () => {
    // A rulebook uses square brackets in prose. Rewriting those would corrupt
    // the text of a game that has no symbols at all.
    assert.deepEqual(split("[see the tournament rules for details]").tokens, [])
  })

  test("expects text a Markdown parser has already handled", () => {
    // A raw link's label DOES look like a token, and that is not a defect: this
    // only ever sees children react-markdown has already parsed, where a link is
    // an element and its label is bare text. The assertion records the
    // precondition so that anybody feeding it raw Markdown finds out here.
    assert.equal(split("[Card Name](card:x/y.webp)").tokens.length, 1)
    assert.equal(split("Card Name").tokens.length, 0, "the parsed label is left alone")
  })

  test("ignores an empty bracket", () => {
    assert.deepEqual(split("[]").tokens, [])
  })

  test("ignores a number too long to be a cost", () => {
    assert.deepEqual(split("[2026]").tokens, [])
  })

  test("ignores a value too long to be a keyword value", () => {
    assert.deepEqual(split("[Shield 1234]").tokens, [])
  })
})

describe("the pattern this file tests is the one that runs", () => {
  test("matches the expression in token-text.tsx", async () => {
    const { readFile } = await import("node:fs/promises")
    const { dirname, resolve } = await import("node:path")
    const { fileURLToPath } = await import("node:url")
    const source = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "token-text.tsx"), "utf8")
    const declared = source.match(/^const TOKEN = (\/.*\/g)$/m)?.[1]
    assert.ok(declared, "token-text.tsx must declare `const TOKEN = /.../g` on one line")
    assert.equal(
      declared,
      TOKEN.toString(),
      "the pattern under test has drifted from the one the component uses",
    )
  })
})
