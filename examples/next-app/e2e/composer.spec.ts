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

test("the input is usable again once a turn ends", async ({ page }) => {
  // While a turn runs the composer is disabled, so a second question cannot
  // interleave into the first one's stream. It must come back afterwards.
  await ask(page, "what does rule 814.1 say")
  await waitForAnswer(page)
  await expect(page.locator(".rk-composer-input")).toBeEnabled()
  await page.locator(".rk-composer-input").fill("another question")
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
