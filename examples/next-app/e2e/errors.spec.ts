import { expect, test } from "@playwright/test"
import { ask, openFreshChat } from "./helpers.ts"

/**
 * What a reader sees when something fails.
 *
 * The behaviour that matters most here is invisible: a turn nothing answered
 * must NOT become part of the conversation. If it does, the next question counts
 * as a follow-up, which skips every free stage and goes straight to a model,
 * carrying an apology as its context.
 *
 * Each failure is provoked by intercepting the request the reader's own click
 * fired, so the browser really does the asking.
 */

test.beforeEach(async ({ page }) => {
  await openFreshChat(page)
})

test("shows a server refusal on the turn itself", async ({ page }) => {
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "retry-after": "60" },
      body: JSON.stringify({ error: "You are over your daily limit." }),
    }),
  )
  await ask(page, "what is Deflect")
  await expect(page.locator(".rk-error")).toContainText("over your daily limit")
})

test("passes a retry delay to the host app", async ({ page }) => {
  await page.route("**/api/ask", (route) =>
    route.fulfill({
      status: 429,
      contentType: "application/json",
      headers: { "retry-after": "60" },
      body: JSON.stringify({ error: "Slow down." }),
    }),
  )
  await ask(page, "what is Deflect")
  await expect(page.locator(".app-notice")).toContainText("60 seconds")
})

test("a failed turn does not become conversation", async ({ page }) => {
  // The important one. A failed turn kept as history makes the next question a
  // follow-up, which skips every free stage.
  await page.route("**/api/ask", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }),
  )
  await ask(page, "what is Deflect")
  await expect(page.locator(".rk-error")).toBeVisible()
  await page.unroute("**/api/ask")

  // The next request must carry no history at all.
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/ask") && r.method() === "POST"),
    ask(page, "what does rule 814.1 say"),
  ])
  const body = JSON.parse(request.postData() ?? "{}")
  expect(body.history).toEqual([])
})

test("a failed turn is not saved as a conversation", async ({ page }) => {
  await page.route("**/api/ask", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }),
  )
  await ask(page, "what is Deflect")
  await expect(page.locator(".rk-error")).toBeVisible()
  await expect(page.locator(".rk-session-open")).toHaveCount(0)
})

test("reports a lost connection as a connection problem", async ({ page }) => {
  // Not as a server error. A reader who is told the server failed goes looking
  // in the wrong place.
  await page.route("**/api/ask", (route) => route.abort("failed"))
  await ask(page, "what is Deflect")
  await expect(page.locator(".app-notice")).toContainText("No connection")
})

test("survives a reply that is not JSON at all", async ({ page }) => {
  // A failing proxy answers with HTML. Reading it as JSON throws, and the throw
  // used to be reported as "no connection" for what is really a server error.
  await page.route("**/api/ask", (route) =>
    route.fulfill({ status: 502, contentType: "text/html", body: "<html>gateway error</html>" }),
  )
  await ask(page, "what is Deflect")
  await expect(page.locator(".rk-error")).toContainText("502")
})

test("an empty reply is a failure, not a blank answer", async ({ page }) => {
  await page.route("**/api/ask", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "" }),
  )
  await ask(page, "what is Deflect")
  await expect(page.locator(".rk-error")).toContainText("empty reply")
})

test("recovers once the failure clears", async ({ page }) => {
  await page.route("**/api/ask", (route) =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }),
  )
  await ask(page, "what is Deflect")
  await expect(page.locator(".rk-error")).toBeVisible()

  await page.unroute("**/api/ask")
  await ask(page, "what does rule 814.1 say")
  await expect(page.locator(".rk-answer")).toContainText("814.1")
  await expect(page.locator(".app-notice")).toHaveCount(0)
})
