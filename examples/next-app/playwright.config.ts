import { defineConfig, devices } from "@playwright/test"

/**
 * The interface, tested in the only place it actually runs.
 *
 * The chat is components, hooks, a streaming transport, and an HTTP handler, and
 * every one of them only behaves correctly in a browser against a real server.
 * Testing them against a fake DOM would prove the parts and not the thing.
 *
 * MOST OF THIS NEEDS NO MODEL CREDENTIAL. The free stages answer a rule
 * question, a legality question and a definition question in milliseconds, so
 * four of the five specs run on a clean checkout with nothing configured. The
 * spec that exercises the model skips itself, loudly, when no key is set.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3211)

/** The corpus this app serves. It must name the same directory as `app/lib/rulekit.ts`. */
const CORPUS = process.env.RULEKIT_CORPUS ?? "data/riftbound"

export default defineConfig({
  testDir: "./e2e",
  // A streaming answer from a model takes tens of seconds. The free stages take
  // milliseconds, so this ceiling only ever binds on the one spec that pays.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker. The server holds one in-memory answer cache, and a second worker
  // asking the same question would race it and see another worker's cache hit.
  workers: 1,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // THE CORPUS DATABASE IS BUILT FIRST, on every run.
    //
    // `corpus.db` is a build artefact and is not in version control, so a fresh
    // clone holds none. Without it `next build` fails while it reads the ask
    // route, and Next reports "Failed to collect page data for /api/ask". That
    // message names neither the file that is missing nor the command that
    // writes it, and the store's own clear error never reaches the screen.
    // Building it here takes about a second and removes a setup step that
    // nobody can guess.
    //
    // THE WORKSPACE PACKAGES ARE BUILT TOO, for the same reason.
    //
    // Both packages point every import at their compiled output, and a fresh
    // clone holds none. Without this step Next reports a missing module for
    // every rulekit import, and the message names no command that would write
    // one.
    //
    // Then production mode, because that is what the streaming path behaves
    // like. `next dev` re-compiles on the first request and the extra seconds
    // land inside the assertions that time how fast a free answer arrives.
    command: `pnpm -w rulekit build ${CORPUS} && pnpm -w build && pnpm build && pnpm exec next start --port ${PORT}`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
})
