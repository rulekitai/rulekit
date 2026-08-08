import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import {
  type DeviceCodeConfig,
  fromDeviceLogin,
  MemoryTokenStore,
  pollDeviceLogin,
  refreshDeviceToken,
  startDeviceLogin,
} from "./oauth.ts"

/**
 * The device sign-in, tested against a stubbed provider.
 *
 * This is a credential flow, so the cases that matter are the ones where a
 * provider says something other than yes. Two of them — `authorization_pending`
 * and `slow_down` — arrive as HTTP 400 with an error body, and treating either
 * as a failure would abandon a sign-in the person is halfway through.
 */

const CONFIG: DeviceCodeConfig = {
  deviceAuthorizationUrl: "https://provider.test/device/code",
  tokenUrl: "https://provider.test/token",
  clientId: "test-client",
  scope: "model.read",
}

const realFetch = globalThis.fetch

/** Answer the next requests with these bodies, in order. */
function stubFetch(responses: { status?: number; body: unknown }[]): { calls: URLSearchParams[] } {
  const calls: URLSearchParams[] = []
  let index = 0
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    calls.push(new URLSearchParams(String(init?.body ?? "")))
    const next = responses[Math.min(index++, responses.length - 1)] ?? { body: {} }
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200 })
  }) as typeof fetch
  return { calls }
}

afterEach(() => {
  globalThis.fetch = realFetch
})

describe("starting a sign-in", () => {
  test("returns the code and the page for a person to open", async () => {
    stubFetch([
      {
        body: {
          device_code: "dev-123",
          user_code: "WXYZ-1234",
          verification_uri: "https://provider.test/activate",
          verification_uri_complete: "https://provider.test/activate?code=WXYZ-1234",
          expires_in: 900,
          interval: 5,
        },
      },
    ])
    const started = await startDeviceLogin(CONFIG)
    assert.equal(started.deviceCode, "dev-123")
    assert.equal(started.userCode, "WXYZ-1234")
    assert.equal(started.verificationUri, "https://provider.test/activate")
    assert.equal(started.intervalSeconds, 5)
  })

  test("waits five seconds between polls when the provider names no interval", async () => {
    // Polling faster than a provider allows earns a slow_down and then a
    // refusal, so the specified default is not a detail.
    stubFetch([{ body: { device_code: "d", user_code: "u", verification_uri: "https://x.test" } }])
    assert.equal((await startDeviceLogin(CONFIG)).intervalSeconds, 5)
  })

  test("sends the client id and the scope", async () => {
    const { calls } = stubFetch([{ body: { device_code: "d", user_code: "u", verification_uri: "x" } }])
    await startDeviceLogin(CONFIG)
    assert.equal(calls[0]?.get("client_id"), "test-client")
    assert.equal(calls[0]?.get("scope"), "model.read")
  })

  test("reports a refusal rather than returning an empty code", async () => {
    stubFetch([{ status: 400, body: { error: "invalid_client", error_description: "unknown client" } }])
    await assert.rejects(() => startDeviceLogin(CONFIG), /unknown client/)
  })
})

describe("polling for approval", () => {
  test("returns null while the person has not approved yet", async () => {
    // The ordinary state of a poll, and it arrives as an HTTP 400. Treating it
    // as an error would abandon a sign-in in progress.
    stubFetch([{ status: 400, body: { error: "authorization_pending" } }])
    assert.equal(await pollDeviceLogin(CONFIG, "dev-123"), null)
  })

  test("treats slow_down the same way", async () => {
    stubFetch([{ status: 400, body: { error: "slow_down" } }])
    assert.equal(await pollDeviceLogin(CONFIG, "dev-123"), null)
  })

  test("returns the token once the person approves", async () => {
    stubFetch([{ body: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600 } }])
    const token = await pollDeviceLogin(CONFIG, "dev-123")
    assert.equal(token?.accessToken, "at-1")
    assert.equal(token?.refreshToken, "rt-1")
    assert.ok((token?.expiresAt ?? 0) > Date.now())
  })

  test("records no expiry when the provider states none", async () => {
    stubFetch([{ body: { access_token: "at-1" } }])
    assert.equal((await pollDeviceLogin(CONFIG, "d"))?.expiresAt, null)
  })

  test("raises a real refusal", async () => {
    stubFetch([{ status: 400, body: { error: "expired_token", error_description: "the code expired" } }])
    await assert.rejects(() => pollDeviceLogin(CONFIG, "dev-123"), /the code expired/)
  })

  test("raises when a success carries no token", async () => {
    stubFetch([{ body: { token_type: "bearer" } }])
    await assert.rejects(() => pollDeviceLogin(CONFIG, "d"), /no access token/)
  })

  test("names the endpoint when a body is not JSON at all", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>gateway error</html>", { status: 502 })) as typeof fetch
    await assert.rejects(() => pollDeviceLogin(CONFIG, "d"), /not JSON/)
  })
})

describe("refreshing", () => {
  test("exchanges a refresh token for a new access token", async () => {
    const { calls } = stubFetch([{ body: { access_token: "at-2", expires_in: 3600 } }])
    const token = await refreshDeviceToken(CONFIG, "rt-1")
    assert.equal(token.accessToken, "at-2")
    assert.equal(calls[0]?.get("grant_type"), "refresh_token")
  })

  test("keeps the old refresh token when the provider sends none back", async () => {
    stubFetch([{ body: { access_token: "at-2" } }])
    assert.equal((await refreshDeviceToken(CONFIG, "rt-1")).refreshToken, "rt-1")
  })

  test("adopts a rotated refresh token", async () => {
    // A provider that rotates them sends a new one. Keeping the old would work
    // until the first rotation and then fail with no cause.
    stubFetch([{ body: { access_token: "at-2", refresh_token: "rt-2" } }])
    assert.equal((await refreshDeviceToken(CONFIG, "rt-1")).refreshToken, "rt-2")
  })
})

describe("resolving a credential from a stored sign-in", () => {
  test("returns nothing when nobody has signed in", async () => {
    const resolver = fromDeviceLogin(CONFIG, new MemoryTokenStore())
    assert.equal(await resolver.resolve(null), null)
  })

  test("returns a token that is still good, without calling the provider", async () => {
    const store = new MemoryTokenStore()
    await store.write("default", { accessToken: "at-1", expiresAt: Date.now() + 3_600_000 })
    globalThis.fetch = (async () => {
      throw new Error("must not call the provider for a token that is still valid")
    }) as typeof fetch
    assert.equal(await fromDeviceLogin(CONFIG, store).resolve(null), "at-1")
  })

  test("refreshes before expiry rather than after, so no request races the clock", async () => {
    const store = new MemoryTokenStore()
    // Inside the one-minute buffer: still valid, but not for long enough.
    await store.write("default", {
      accessToken: "at-old",
      refreshToken: "rt-1",
      expiresAt: Date.now() + 30_000,
    })
    stubFetch([{ body: { access_token: "at-new", expires_in: 3600 } }])
    assert.equal(await fromDeviceLogin(CONFIG, store).resolve(null), "at-new")
    assert.equal((await store.read("default"))?.accessToken, "at-new", "the new token must be saved")
  })

  test("gives up rather than looping when an expired token cannot be refreshed", async () => {
    const store = new MemoryTokenStore()
    await store.write("default", { accessToken: "at-old", expiresAt: Date.now() - 1000 })
    assert.equal(await fromDeviceLogin(CONFIG, store).resolve(null), null)
  })

  test("keeps one reader's token apart from another's", async () => {
    // The default is a single shared sign-in, which suits one operator. A
    // deployment serving several readers must key them apart, or they all spend
    // the same account.
    const store = new MemoryTokenStore()
    await store.write("reader-a", { accessToken: "token-a", expiresAt: Date.now() + 3_600_000 })
    await store.write("reader-b", { accessToken: "token-b", expiresAt: Date.now() + 3_600_000 })
    const resolver = fromDeviceLogin(
      CONFIG,
      store,
      (request) => request?.headers.get("x-reader") ?? "default",
    )
    const asA = new Request("https://app.test", { headers: { "x-reader": "reader-a" } })
    const asB = new Request("https://app.test", { headers: { "x-reader": "reader-b" } })
    assert.equal(await resolver.resolve(asA), "token-a")
    assert.equal(await resolver.resolve(asB), "token-b")
  })
})
