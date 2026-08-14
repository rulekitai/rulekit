import { expect, test } from "@playwright/test"
import { ask, lastAnswer, openFreshChat, waitForAnswer } from "./helpers.ts"

/**
 * What a reader is told about an answer that came back from the cache.
 *
 * A cache hit is not a fresh answer, and it is also not a rules lookup. It is
 * whatever wrote the answer the first time, served again. The server keeps that
 * apart: `servedBy` becomes "cache" and `source` stays "agent".
 *
 * The interface used to drop `source`, so a model's own words were labelled
 * "no AI wrote this" on every repeated question — which is every question the
 * cache exists for. This project's whole claim is provenance, so the label a
 * reader reads under an answer has to survive the cache.
 *
 * NO MODEL AND NO NETWORK. The reply to the request the reader's own send
 * already fired is replaced with the two shapes the endpoint really returns.
 */

/** A cache hit: one JSON object, no stream, no `type` field. */
const CACHED = {
  text: "A unit with Guard may be chosen as the blocker by the attacking player.",
  citations: [],
  source: "agent",
  servedBy: "cache",
  latencyMs: 0,
  model: null,
}

const QUESTION = "how does guard change who blocks"

test.beforeEach(async ({ page }) => {
  await openFreshChat(page)
})

test("says a model wrote a cached answer that a model wrote", async ({ page }) => {
  // Fulfilled, not synthesised: the request below is the one the reader's own
  // Enter key fires, and only the reply is replaced.
  await page.route("**/api/ask", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify(CACHED),
    })
  })
  await ask(page, QUESTION)
  await waitForAnswer(page)

  const answer = lastAnswer(page)
  // The trace line still says where it came from, and that is true.
  await expect(answer.locator(".rk-meta")).toContainText("from a saved answer")
  // The disclaimer says who wrote it, and that must not contradict the trace.
  await expect(answer.locator(".rk-disclaimer")).toContainText("Written by an AI")
})

test("says no model wrote a cached answer that no model wrote", async ({ page }) => {
  // The other half. A free stage's answer stays a free stage's answer across the
  // cache, and telling this reader an AI wrote it would be the same fault
  // pointing the other way.
  await page.route("**/api/ask", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
      body: JSON.stringify({ ...CACHED, source: "static" }),
    })
  })
  await ask(page, QUESTION)
  await waitForAnswer(page)

  const answer = lastAnswer(page)
  await expect(answer.locator(".rk-meta")).toContainText("from a saved answer")
  await expect(answer.locator(".rk-disclaimer")).toContainText("with no AI")
})
