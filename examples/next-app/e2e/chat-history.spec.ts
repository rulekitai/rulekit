import { expect, test } from "@playwright/test"
import { ask, openFreshChat, waitForAnswer } from "./helpers.ts"

/**
 * Conversations, kept in the browser.
 *
 * The example app has no login and no database on purpose, so history is the
 * one piece of state it owns. Two behaviours here are subtle and both are
 * already implemented: a turn nothing answered must not be saved, and a turn
 * must be saved into the conversation it was ASKED in.
 */

test.beforeEach(async ({ page }) => {
  await openFreshChat(page)
})

test("saves a conversation and titles it from the question", async ({ page }) => {
  await ask(page, "what is Deflect")
  await waitForAnswer(page)
  await expect(page.locator(".rk-session-open")).toHaveText("what is Deflect")
})

test("keeps a conversation across a reload", async ({ page }) => {
  await ask(page, "what does rule 814.1 say")
  await waitForAnswer(page)
  await page.reload()
  await expect(page.locator(".rk-session-open")).toHaveText("what does rule 814.1 say")
})

test("reopens a conversation with its messages", async ({ page }) => {
  await ask(page, "what is Deflect")
  await waitForAnswer(page)
  await page.locator(".rk-session-new").click()
  await expect(page.locator(".rk-row")).toHaveCount(0)

  await page.locator(".rk-session-open").first().click()
  await expect(page.locator(".rk-bubble-user")).toHaveText("what is Deflect")
  await expect(page.locator(".rk-row-assistant")).toHaveCount(1)
})

test("starts a second conversation without touching the first", async ({ page }) => {
  await ask(page, "what is Deflect")
  await waitForAnswer(page)
  await page.locator(".rk-session-new").click()
  await ask(page, "what is Shield")
  await waitForAnswer(page)
  await expect(page.locator(".rk-session-open")).toHaveCount(2)
})

test("renames a conversation", async ({ page }) => {
  await ask(page, "what is Deflect")
  await waitForAnswer(page)
  await page.getByRole("button", { name: /^Rename/ }).click()
  const field = page.locator(".rk-session-rename")
  await field.fill("Keyword questions")
  await field.press("Enter")
  await expect(page.locator(".rk-session-open")).toHaveText("Keyword questions")
})

test("abandons a rename on Escape rather than trapping the reader in it", async ({ page }) => {
  await ask(page, "what is Deflect")
  await waitForAnswer(page)
  await page.getByRole("button", { name: /^Rename/ }).click()
  const field = page.locator(".rk-session-rename")
  await field.fill("discard me")
  await field.press("Escape")
  await expect(page.locator(".rk-session-open")).toHaveText("what is Deflect")
})

test("deletes a conversation", async ({ page }) => {
  await ask(page, "what is Deflect")
  await waitForAnswer(page)
  await page.getByRole("button", { name: /^Delete/ }).click()
  await expect(page.locator(".rk-session-open")).toHaveCount(0)
})

test("survives history the browser cannot read", async ({ page }) => {
  // Storage holding something else entirely must not stop somebody asking a
  // new question. Losing the history is bad; losing the app is worse.
  await page.evaluate(() => localStorage.setItem("rulekit:chats", "not json at all"))
  await page.reload()
  await ask(page, "what is Deflect")
  await waitForAnswer(page)
  await expect(page.locator(".rk-row-assistant")).toHaveCount(1)
})
