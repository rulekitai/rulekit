import { expect, test } from "@playwright/test"
import { ask, HAS_MODEL_KEY, lastAnswer, openFreshChat, waitForAnswer } from "./helpers.ts"

/**
 * The streaming path, against a real model.
 *
 * This is the only spec that costs money, and the only one that proves the three
 * things a reader actually experiences during a slow answer: that the tool calls
 * appear as they happen, that text arrives before the turn ends, and that the
 * view follows the answer only while they are at the bottom of it.
 */

test.skip(
  !HAS_MODEL_KEY,
  "No model credential. Set AI_GATEWAY_API_KEY to run the streaming spec; the other specs need none.",
)

/** A question no free stage can answer, so it always reaches the model. */
const REASONING_QUESTION = "how does Deflect interact with Shield when both are granted to the same unit"

test.beforeEach(async ({ page }) => {
  await openFreshChat(page)
})

test("shows the tool calls as they happen, then the answer", async ({ page }) => {
  await ask(page, REASONING_QUESTION)

  // The waiting indicator appears first, because the model takes seconds.
  await expect(page.locator(".rk-thinking")).toBeVisible({ timeout: 15_000 })

  // Then the trace, which is the only part of the interface that shows the
  // grounding really happened.
  const trace = lastAnswer(page).locator(".rk-trace-summary")
  await expect(trace).toBeVisible({ timeout: 60_000 })
  await expect(trace).toContainText(/Searched|Looked up|Read/)

  const answer = await waitForAnswer(page, 180_000)
  await expect(answer.locator(".rk-answer")).not.toBeEmpty()
})

test("the trace opens to name each lookup", async ({ page }) => {
  await ask(page, REASONING_QUESTION)
  await waitForAnswer(page, 180_000)
  await lastAnswer(page).locator(".rk-trace-summary").click()
  const steps = lastAnswer(page).locator(".rk-trace-steps li")
  await expect(steps.first()).toBeVisible()
  // Every step reads as something a person did, not as a function name.
  await expect(steps.first()).toContainText(/Searched|Looked up|Read|Checked/)
})

test("text arrives before the turn ends", async ({ page }) => {
  // Streaming is the whole reason this path exists. If the text only appears at
  // the end, a reader waits half a minute at a blank screen.
  await ask(page, REASONING_QUESTION)
  const answerText = lastAnswer(page).locator(".rk-answer")
  await expect(answerText).not.toBeEmpty({ timeout: 120_000 })
  // The composer is still disabled, so the turn has not finished yet.
  await expect(page.locator(".rk-composer-send")).toBeDisabled()
})

test("the answer cites rules from the corpus", async ({ page }) => {
  await ask(page, REASONING_QUESTION)
  const answer = await waitForAnswer(page, 180_000)
  await expect(answer).toContainText(/\d{3}\.\d/)
  await expect(answer.locator(".rk-quote").first()).toBeVisible()
})

test("stops following the answer once the reader scrolls up", async ({ page }) => {
  // The single most irritating thing a chat can do is drag somebody back to the
  // bottom while they are reading. The view follows only while they are already
  // at the bottom.
  await ask(page, REASONING_QUESTION)
  const scroller = page.locator(".rk-scroller")
  await expect(lastAnswer(page).locator(".rk-answer")).not.toBeEmpty({ timeout: 120_000 })

  await scroller.evaluate((node) => {
    node.scrollTop = 0
  })
  const parked = await scroller.evaluate((node) => node.scrollTop)
  await page.waitForTimeout(3_000)
  const after = await scroller.evaluate((node) => node.scrollTop)
  expect(after).toBe(parked)

  await waitForAnswer(page, 180_000)
})

test("saves the answer into the conversation it was asked in", async ({ page }) => {
  // Opening another conversation mid-answer must not write this answer into it.
  await ask(page, "what is Deflect")
  await waitForAnswer(page)

  await page.locator(".rk-session-new").click()
  await ask(page, REASONING_QUESTION)
  await expect(lastAnswer(page).locator(".rk-answer")).not.toBeEmpty({ timeout: 120_000 })

  // Switch away while the model is still writing.
  await page.locator(".rk-session-open").first().click()
  await expect(page.locator(".rk-bubble-user")).toHaveText("what is Deflect")
  await page.waitForTimeout(5_000)
  // The first conversation still holds exactly its own one exchange.
  await expect(page.locator(".rk-row-assistant")).toHaveCount(1)
  await expect(page.locator(".rk-answer")).toContainText("Deflect")
})
