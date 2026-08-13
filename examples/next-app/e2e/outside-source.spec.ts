import { expect, test } from "@playwright/test"
import { ask, lastAnswer, openFreshChat, waitForAnswer } from "./helpers.ts"

/**
 * What a reader sees when an answer read something outside the rules data.
 *
 * This project's whole claim is that every statement traces to the corpus. A
 * reference site breaks that claim on purpose, so the interface has to say so —
 * and it has to say so where a reader who never opens the trace still sees it.
 *
 * NO MODEL AND NO NETWORK. The reply to the request the reader's own send
 * already fired is intercepted and answered with a stream carrying one step
 * that names an outside source. That is the one way to reach this screen: the
 * example ships an empty site list on purpose, and a spec that needed one
 * configured would be a spec that read somebody's website on every run.
 */

/** One NDJSON event per line, which is what the ask endpoint streams. */
const line = (event: unknown) => `${JSON.stringify(event)}\n`

const SOURCE = { name: "Example FAQ", url: "https://faq.example.com/cards/x", official: false }

const STREAM =
  line({
    type: "step",
    step: {
      id: "1",
      tool: "search_all",
      label: "Searched the rules",
      kind: "searched",
      status: "completed",
    },
  }) +
  line({
    type: "step",
    step: {
      id: "2",
      tool: "fetch_reference",
      label: "Read Example FAQ",
      kind: "read",
      status: "completed",
      source: SOURCE,
    },
  }) +
  line({ type: "text", text: "The rules data does not cover this." }) +
  line({
    type: "done",
    text:
      "The rules data does not cover this. Example FAQ, which is not the rules data, says the ability " +
      "resolves in two passes.",
    source: "agent",
    complete: true,
    model: "test/model",
    latencyMs: 12,
    usage: null,
  })

test.beforeEach(async ({ page }) => {
  await openFreshChat(page)
  // Fulfilled, not synthesised. The request below is the one the reader's own
  // Enter key fires; only the reply is replaced.
  await page.route("**/api/ask", async (route) => {
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
      body: STREAM,
    })
  })
})

const QUESTION = "how does the ability resolve when two players choose at once"

test("says in the closed trace that a source outside the rules data was read", async ({ page }) => {
  await ask(page, QUESTION)
  await waitForAnswer(page)
  // The CLOSED summary, because a reader who never expands the trace is exactly
  // the reader who most needs to know this.
  const summary = lastAnswer(page).locator(".rk-trace-summary")
  await expect(summary).toContainText("outside the rules data")
})

test("names the site and links to the page it read", async ({ page }) => {
  await ask(page, QUESTION)
  await waitForAnswer(page)
  await lastAnswer(page).locator(".rk-trace-summary").click()

  const link = lastAnswer(page).locator('.rk-trace-source a[href="https://faq.example.com/cards/x"]')
  await expect(link).toBeVisible()
  await expect(link).toHaveText("Example FAQ")
  // A page this project does not control opens in its own tab, and never with
  // a handle back to this one.
  await expect(link).toHaveAttribute("rel", /noopener/)
  await expect(link).toHaveAttribute("target", "_blank")
})

test("marks an unofficial site as unofficial", async ({ page }) => {
  await ask(page, QUESTION)
  await waitForAnswer(page)
  await lastAnswer(page).locator(".rk-trace-summary").click()
  await expect(lastAnswer(page).locator(".rk-trace-source")).toContainText("unofficial")
})

test("repeats it in the disclaimer under the answer", async ({ page }) => {
  // The trace can be scrolled past. The disclaimer sits directly under the
  // words a reader is about to act on.
  await ask(page, QUESTION)
  await waitForAnswer(page)
  const disclaimer = lastAnswer(page).locator(".rk-disclaimer")
  await expect(disclaimer).toContainText("Example FAQ")
  await expect(disclaimer).toContainText("outside the rules data")
})

test("says nothing about outside sources when no answer read one", async ({ page }) => {
  // Almost every answer. A warning that appears on all of them is one nobody
  // reads on the answer that needed it.
  await page.unroute("**/api/ask")
  await ask(page, "what does rule 814.1 say")
  await waitForAnswer(page)
  await expect(lastAnswer(page)).not.toContainText("outside the rules data")
})
