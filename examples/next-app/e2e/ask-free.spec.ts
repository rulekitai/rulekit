import { expect, test } from "@playwright/test"
import { ask, lastAnswer, openFreshChat, servedBy, waitForAnswer } from "./helpers.ts"

/**
 * The three shapes of question that need no model.
 *
 * These are the answers this project gives away: a rule read by number, a
 * legality verdict read from rows, and a definition read from the glossary. All
 * three must arrive cited, and all three must arrive fast enough that a reader
 * never sees a waiting state.
 */

test.beforeEach(async ({ page }) => {
  await openFreshChat(page)
})

test("reads a rule by its number, and cites it", async ({ page }) => {
  await ask(page, "what does rule 814.1 say")
  const answer = await waitForAnswer(page)
  await expect(answer).toContainText("814.1")
  await expect(answer).toContainText("Shield")
  expect(await servedBy(page)).toContain("read from the rules data")
})

test("quotes the rule rather than restating it", async ({ page }) => {
  // The quote is the evidence. An answer that paraphrases is one a reader
  // cannot check, which is the whole thing this project is for.
  await ask(page, "what does rule 814.1 say")
  await waitForAnswer(page)
  await expect(lastAnswer(page).locator(".rk-quote")).toBeVisible()
})

test("answers a legality question with its effective date", async ({ page }) => {
  // A verdict with no date cannot be audited against the list it came from.
  await ask(page, "is Called Shot banned")
  const answer = await waitForAnswer(page)
  await expect(answer).toContainText("banned list")
  await expect(answer).toContainText(/Effective \d{4}-\d{2}-\d{2}/)
})

test("names every printing when a reader asks about a shared name", async ({ page }) => {
  // A reader who types a character name means all of its cards. Naming one
  // reads as a verdict on all of them.
  await ask(page, "is Yasuo banned")
  const answer = await waitForAnswer(page)
  await expect(answer).toContainText("not on the banned list")
  await expect(answer).toContainText("printings it checked")
  await expect(answer.locator("li")).toHaveCount(3)
})

test("defines a keyword from the glossary and cites the defining rule", async ({ page }) => {
  await ask(page, "what is Deflect")
  const answer = await waitForAnswer(page)
  await expect(answer).toContainText("Deflect")
  await expect(answer).toContainText(/Defined in rule \d+/)
  expect(await servedBy(page)).toContain("read from the glossary")
})

test("serves a repeat from the cache, in a new conversation", async ({ page }) => {
  await ask(page, "what does rule 809.1 say")
  await waitForAnswer(page)

  // A NEW conversation, deliberately. Asking again in the same one makes the
  // second question a follow-up, and a follow-up depends on what came before it,
  // so it correctly skips every free stage. That is the design, not a miss.
  await page.locator(".rk-session-new").click()
  await ask(page, "What does rule 809.1 say?")
  await waitForAnswer(page)

  // Punctuation and capitalisation fold onto the same entry.
  expect(await servedBy(page)).toContain("saved answer")
})

test("a follow-up skips the free stages, because it depends on context", async ({ page }) => {
  // The other half of the rule above, asserted directly: the same words asked
  // again in the same conversation are a different question.
  await ask(page, "what does rule 809.1 say")
  await waitForAnswer(page)
  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().includes("/api/ask") && r.method() === "POST"),
    ask(page, "what does rule 809.1 say"),
  ])
  const body = JSON.parse(request.postData() ?? "{}")
  expect(body.history.length).toBeGreaterThan(0)
})

test("shows the AI notice on an answer", async ({ page }) => {
  await ask(page, "what is Deflect")
  await waitForAnswer(page)
  await expect(lastAnswer(page).locator(".rk-disclaimer")).toBeVisible()
})

test("a free answer arrives without a waiting state", async ({ page }) => {
  // A free stage answers in milliseconds. If a reader sees the waiting
  // indicator for one of these, something is reaching a model that should not.
  await ask(page, "what does rule 814.1 say")
  await waitForAnswer(page, 5_000)
  await expect(page.locator(".rk-thinking")).toHaveCount(0)
})
