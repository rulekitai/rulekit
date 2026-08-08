import type { CredentialResolver } from "./types.ts"

/**
 * Signing in to a model provider with an account rather than an API key.
 *
 * **Everything here is configuration.** No provider is named, no client id is
 * built in, and no endpoint is hardcoded. That is on purpose: whether a
 * particular provider permits a third-party client to sign a person in, and on
 * what terms, is that provider's decision and it changes. The person deploying
 * this picks a provider they are permitted to use and supplies its details.
 *
 * This implements the OAuth 2.0 Device Authorization Grant (RFC 8628), which is
 * the flow for a client that cannot host a browser redirect.
 */

export type DeviceCodeConfig = {
  /** Where to ask for a device code. */
  deviceAuthorizationUrl: string
  /** Where to exchange an approved device code for a token. */
  tokenUrl: string
  clientId: string
  scope?: string
  /** Extra fields both requests carry. */
  extraParams?: Record<string, string>
}

export type DeviceCodeStart = {
  deviceCode: string
  /** The code a person types into the page below. */
  userCode: string
  /** The page a person opens to approve. */
  verificationUri: string
  /** The same page with the code already filled in, when the provider offers it. */
  verificationUriComplete?: string
  expiresInSeconds: number
  intervalSeconds: number
}

export type DeviceCodeToken = {
  accessToken: string
  refreshToken?: string
  /** Unix milliseconds, or null when the provider gave no expiry. */
  expiresAt: number | null
}

/** Somewhere to keep a token between requests. Supply one, or tokens die with the process. */
export interface TokenStore {
  read(subject: string): Promise<DeviceCodeToken | null>
  write(subject: string, token: DeviceCodeToken): Promise<void>
}

/** A token store in this process's memory. Fine for one server, useless for several. */
export class MemoryTokenStore implements TokenStore {
  #tokens = new Map<string, DeviceCodeToken>()
  async read(subject: string): Promise<DeviceCodeToken | null> {
    return this.#tokens.get(subject) ?? null
  }
  async write(subject: string, token: DeviceCodeToken): Promise<void> {
    this.#tokens.set(subject, token)
  }
}

const form = (params: Record<string, string | undefined>) => {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) body.set(key, value)
  return body
}

async function postForm(
  url: string,
  params: Record<string, string | undefined>,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form(params),
  })
  const text = await res.text()
  let json: Record<string, unknown>
  try {
    json = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new Error(`${url} answered ${res.status} with a body that is not JSON`)
  }
  // A device-grant error is a 400 with a meaningful body, so the body is read
  // before the status is judged. Throwing on the status alone loses the reason.
  if (!res.ok && !json.error) throw new Error(`${url} answered ${res.status}`)
  return json
}

/** Ask the provider for a device code. Show the person the code and the page. */
export async function startDeviceLogin(config: DeviceCodeConfig): Promise<DeviceCodeStart> {
  const json = await postForm(config.deviceAuthorizationUrl, {
    client_id: config.clientId,
    scope: config.scope,
    ...config.extraParams,
  })
  if (json.error)
    throw new Error(`device authorization refused: ${String(json.error_description ?? json.error)}`)
  return {
    deviceCode: String(json.device_code ?? ""),
    userCode: String(json.user_code ?? ""),
    verificationUri: String(json.verification_uri ?? json.verification_url ?? ""),
    verificationUriComplete: json.verification_uri_complete
      ? String(json.verification_uri_complete)
      : undefined,
    expiresInSeconds: Number(json.expires_in ?? 900),
    // RFC 8628 says five seconds when the provider states no interval. Polling
    // faster than the provider allows earns a slow_down and then a refusal.
    intervalSeconds: Number(json.interval ?? 5),
  }
}

/** One poll. Null means the person has not approved yet. */
export async function pollDeviceLogin(
  config: DeviceCodeConfig,
  deviceCode: string,
): Promise<DeviceCodeToken | null> {
  const json = await postForm(config.tokenUrl, {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: deviceCode,
    client_id: config.clientId,
    ...config.extraParams,
  })
  const error = typeof json.error === "string" ? json.error : null
  // These two are the normal state of a poll, not a failure.
  if (error === "authorization_pending" || error === "slow_down") return null
  if (error) throw new Error(`sign-in failed: ${String(json.error_description ?? error)}`)
  const accessToken = String(json.access_token ?? "")
  if (!accessToken) throw new Error("sign-in returned no access token")
  const expiresIn = Number(json.expires_in ?? 0)
  return {
    accessToken,
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
  }
}

/** Exchange a refresh token for a fresh access token. */
export async function refreshDeviceToken(
  config: DeviceCodeConfig,
  refreshToken: string,
): Promise<DeviceCodeToken> {
  const json = await postForm(config.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    ...config.extraParams,
  })
  if (json.error) throw new Error(`refresh failed: ${String(json.error_description ?? json.error)}`)
  const expiresIn = Number(json.expires_in ?? 0)
  return {
    accessToken: String(json.access_token ?? ""),
    // A provider that rotates refresh tokens sends a new one. Keeping the old
    // one would work until the first rotation and then fail with no cause.
    refreshToken: json.refresh_token ? String(json.refresh_token) : refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
  }
}

/** Refresh this many seconds before a token expires, so no request races the clock. */
const REFRESH_BUFFER_SECONDS = 60

/**
 * A credential from a stored sign-in.
 *
 * `subjectOf` says which stored token this request may use. It defaults to a
 * single shared token, which suits one operator signing in once. A multi-reader
 * deployment must return something per reader, or every reader spends the same
 * account.
 */
export function fromDeviceLogin(
  config: DeviceCodeConfig,
  store: TokenStore,
  subjectOf: (request: Request | null) => string = () => "default",
): CredentialResolver {
  return {
    async resolve(request: Request | null): Promise<string | null> {
      const subject = subjectOf(request)
      const token = await store.read(subject)
      if (!token) return null
      const expiring =
        token.expiresAt !== null && token.expiresAt - REFRESH_BUFFER_SECONDS * 1000 <= Date.now()
      if (!expiring) return token.accessToken
      if (!token.refreshToken) return null
      const refreshed = await refreshDeviceToken(config, token.refreshToken)
      await store.write(subject, refreshed)
      return refreshed.accessToken
    },
  }
}
