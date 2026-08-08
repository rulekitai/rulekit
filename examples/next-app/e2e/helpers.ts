import { expect, type Locator, type Page } from "@playwright/test"

/**
 * What every spec needs, in one place.
 *
 * The selectors are the class names `@rulekit/ui` ships. That is deliberate: a
 * fork restyles by overriding CSS variables and keeps the classes, so a test
 * written against them keeps working. Adding test-only attributes to the
 * components would put test scaffolding in a package other people install.
 */

/** A chat with no saved conversations, whatever a previous spec left behind. */
export async function openFreshChat(page: Page): Promise<void> {
  await page.goto("/")
  // Conversations live in the browser. Clearing before each spec is what stops
  // one spec's history changing what the next one sees.
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.locator(".rk-composer-input")).toBeVisible()
}

export async function ask(page: Page, question: string): Promise<void> {
  const input = page.locator(".rk-composer-input")
  await input.fill(question)
  await input.press("Enter")
}

/** The assistant messages currently on screen. */
export function answers(page: Page): Locator {
  return page.locator(".rk-row-assistant")
}

/** The newest assistant message. */
export function lastAnswer(page: Page): Locator {
  return answers(page).last()
}

/** Wait for an answer to arrive and settle. */
export async function waitForAnswer(page: Page, timeout = 30_000): Promise<Locator> {
  const answer = lastAnswer(page)
  await expect(answer).toBeVisible({ timeout })
  // The composer re-enables only once the turn is over, which is a more reliable
  // signal than the text having stopped changing.
  await expect(page.locator(".rk-composer-send")).toBeEnabled({ timeout })
  return answer
}

/** The label under an answer saying which stage produced it. */
export async function servedBy(page: Page): Promise<string> {
  return (await lastAnswer(page).locator(".rk-meta").innerText()).trim()
}

/** True when a model credential is configured, so the paid spec may run. */
export const HAS_MODEL_KEY = Boolean(
  process.env.AI_GATEWAY_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(),
)
