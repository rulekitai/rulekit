import { expect, test } from "@playwright/test"
import { ask, openFreshChat, waitForAnswer } from "./helpers.ts"

/**
 * The input box, and the empty screen that precedes it.
 *
 * Small behaviours, and every one of them is something a reader notices
 * immediately when it is wrong.
 */

test.beforeEach(async ({ page }) => {
  await openFreshChat(page)
})

test("offers questions on the empty screen, and asking one works", async ({ page }) => {
  // A reader who does not know what this covers will type something it declines
  // and read the refusal as a failure. The suggestions teach the scope faster
  // than any paragraph.
  const suggestions = page.locator(".rk-suggestion")
  await expect(suggestions).not.toHaveCount(0)
  await suggestions.first().click()
  await waitForAnswer(page)
  await expect(page.locator(".rk-bubble-user")).toHaveCount(1)
})

test("Enter sends and Shift with Enter makes a new line", async ({ page }) => {
  const input = page.locator(".rk-composer-input")
  await input.fill("first line")
  await input.press("Shift+Enter")
  await input.type("second line")
  await expect(page.locator(".rk-bubble-user")).toHaveCount(0)
  await expect(input).toHaveValue(/first line\nsecond line/)
})

test("the send button is disabled until something is typed", async ({ page }) => {
  const send = page.locator(".rk-composer-send")
  await expect(send).toBeDisabled()
  await page.locator(".rk-composer-input").fill("what is Deflect")
  await expect(send).toBeEnabled()
})

test("clears the box after sending", async ({ page }) => {
  await ask(page, "what is Deflect")
  await waitForAnswer(page)
  await expect(page.locator(".rk-composer-input")).toHaveValue("")
})

test("refuses a second question while one is being answered", async ({ page }) => {
  // Without this, a second question interleaves into the first one's stream and
  // both answers arrive scrambled.
  await page.locator(".rk-composer-input").fill("what does rule 814.1 say")
  await page.locator(".rk-composer-input").press("Enter")
  // The composer must be disabled at some point during the turn, and enabled
  // again once it ends.
  await waitForAnswer(page)
  await expect(page.locator(".rk-composer-send")).toBeEnabled()
})

test("counts down only when the cap is close", async ({ page }) => {
  const input = page.locator(".rk-composer-input")
  await input.fill("short")
  await expect(page.locator(".rk-composer-count")).toHaveCount(0)
  await input.fill("x".repeat(1900))
  await expect(page.locator(".rk-composer-count")).toBeVisible()
})

test("will not accept more than the server would", async ({ page }) => {
  const input = page.locator(".rk-composer-input")
  await input.fill("x".repeat(3000))
  // Stopped in the browser at the same cap the handler enforces, so a reader
  // finds out while typing rather than after waiting for a rejection.
  expect((await input.inputValue()).length).toBe(2000)
})

test("the question appears immediately, before any answer", async ({ page }) => {
  await ask(page, "what is Deflect")
  await expect(page.locator(".rk-bubble-user")).toHaveText("what is Deflect")
})
