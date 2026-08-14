import { z } from "zod"
import type { Cache } from "../pipeline/types.ts"
import { defineTool, type RuleTool } from "./tools.ts"

/**
 * Reading a site the implementer chose, when the corpus cannot answer.
 *
 * NO SITE SHIPS WITH THIS PACKAGE. rulekit names none, recommends none, and
 * endorses none. Every host below arrives from the application that mounted the
 * agent, and that application's owner is responsible for the site's terms of use
 * and for how often they read it.
 *
 * THE CORPUS IS STILL THE SOURCE OF TRUTH. A page read here is a second source
 * and is labelled as one, in the prose the model writes and in the trace the
 * browser renders. The instruction block in `instructions/references.md` is what
 * makes the prose half hold, and it is added ONLY when sites are configured,
 * because without it a fetched page reads as though it were the rules.
 *
 * A model chooses the address, so treat every one as untrusted input. The ten
 * rules `fetchReference` enforces are listed on that function, and each is
 * tested. The one that is easiest to leave out is the redirect: a site that
 * answers a request with a redirect to an address inside the network hosting
 * this server turns a rules assistant into a way to read that network.
 *
 * THIS PACKAGE READS NO robots.txt. A site states its own rules there, and an
 * operator who accepts a site's terms needs somewhere to record them, so
 * `ReferenceSite.disallowPaths` is that place.
 */

export type ReferenceSite = {
  /** What an answer calls this site, e.g. "Riftbound FAQ". */
  name: string
  /** The host, with no scheme and no path. This host and its subdomains only. */
  host: string
  /** One sentence a model reads to choose the site: what it holds, and who publishes it. */
  describes: string
  /**
   * False by default, and false is the safe reading.
   *
   * A community site is one reader's careful reading of the rules. Marking one
   * official tells a reader it carries the publisher's authority, which is a
   * claim they cannot check and would not otherwise make.
   */
  official?: boolean
  /**
   * How a piece's name becomes a page, e.g. "/cards/{slug}".
   *
   * `{slug}` becomes the name in lower case, with runs of non-letters turned
   * into single hyphens. This is a hint for the model, not a guarantee: the site
   * decides its own addresses, and a built address can still be absent.
   */
  cardPath?: string
  /**
   * Address prefixes on this host that must never be read, e.g. `["/api/"]`.
   *
   * **This package reads no robots.txt.** A site states its own rules there, and
   * honouring them is the operator's job, so this is where you write them down.
   * A site that disallows `/api/` needs that prefix here, or a model that builds
   * such an address gets it fetched.
   *
   * A prefix matches the start of the path. Matching is case-insensitive.
   */
  disallowPaths?: string[]
}

export type ReferenceOptions = {
  /** The sites this agent may read. An empty list adds no tools at all. */
  sites: ReferenceSite[]
  /** Defaults to the global fetch. A test passes a stub, so no test needs a network. */
  fetchImpl?: typeof fetch
  /** Turns a fetched page into plain text. Defaults to `stripHtml`. */
  readPage?: (body: string, contentType: string) => string
  /** Default 5000. A slow site must not hold a reader's question open. */
  timeoutMs?: number
  /** Default 200000 characters. Enforced while reading, not after. */
  maxBytes?: number
  /** Default 3. Past it, the model is told to answer from what it has. */
  maxFetchesPerTurn?: number
  /** Where fetched pages are held. Without one, every question refetches. */
  cache?: Cache
  /** Default one hour. */
  cacheTtlSeconds?: number
  /**
   * Sent as the User-Agent header.
   *
   * It names this package and leaves room for a contact address, so a site
   * operator can see who is reading and block it. A tool that reads somebody
   * else's site anonymously gives them no way to say no.
   */
  userAgent?: string
}

const DEFAULTS = {
  timeoutMs: 5_000,
  maxBytes: 200_000,
  maxFetchesPerTurn: 3,
  cacheTtlSeconds: 3_600,
  userAgent: "rulekit (+https://github.com/rulekitai/rulekit)",
} as const

/** Content types a page may carry. Anything else is not a page a reader wanted. */
const READABLE_TYPES = ["text/html", "text/plain", "application/xhtml+xml"]

/** What one successful read returns, and what the trace and the model both see. */
export type ReferencePage = {
  site: string
  url: string
  title: string | null
  text: string
  official: boolean
  /** True when `maxBytes` cut the page short, so the model does not read an ending that is not there. */
  truncated: boolean
}

/** A piece's name as a URL slug: lower case, single hyphens, no leading or trailing one. */
export function slugify(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * A page's readable text, with no HTML parser and no new dependency.
 *
 * This is deliberately crude. It removes the four elements whose contents are
 * never the article, drops the remaining tags, and decodes the five entities
 * that matter. A frequently-asked-questions page reads well enough from that.
 *
 * A site whose text does not survive this needs a real parser, and an
 * implementer supplies one through `readPage`. Adding a parser here would put a
 * dependency in every install to serve the installs that do not need it.
 */
export function stripHtml(body: string, contentType = ""): string {
  if (contentType.includes("text/plain")) return collapse(body)
  const withoutFurniture = body
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(nav|footer|header|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
  const title = withoutFurniture.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? ""
  const text = withoutFurniture
    // A block element ends a line, so words either side of one do not run together.
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)\s*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
  return collapse(decodeEntities(`${title ? `${title}\n\n` : ""}${text}`))
}

/** The page title, for a reader who wants to know what was read. */
function pageTitle(body: string): string | null {
  const found = body.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1]
  const title = found ? collapse(decodeEntities(found)) : ""
  return title || null
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
}

function decodeEntities(text: string): string {
  return text.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    const known = ENTITIES[name.toLowerCase()]
    if (known) return known
    if (name.startsWith("#x") || name.startsWith("#X"))
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16) || 0) || whole
    if (name.startsWith("#")) return String.fromCodePoint(Number.parseInt(name.slice(1), 10) || 0) || whole
    return whole
  })
}

/** Squeeze runs of whitespace, keeping paragraph breaks. */
function collapse(text: string): string {
  return text
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** A configured host, cleaned of a scheme and a path somebody left on it. */
const bareHost = (host: string) =>
  host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")

/**
 * Refuse a site list that would allow more than its author meant.
 *
 * Thrown when the tools are built, not when a page is read, so the mistake
 * surfaces the first time the server starts rather than on some later question.
 *
 * A host with no dot is the one that matters. `host: "com"` reads as "every
 * address ending in .com", because a subdomain of it is any host under it, and
 * `host: "localhost"` points the assistant at the machine it runs on. Neither is
 * something anybody writes on purpose, and neither fails visibly.
 */
function assertUsableSites(sites: ReferenceSite[]): void {
  for (const site of sites) {
    const host = bareHost(site.host)
    if (!host)
      throw new ReferenceFetchError(`The reference site "${site.name}" has no host, so nothing can match it.`)
    if (!host.includes("."))
      throw new ReferenceFetchError(
        `The reference site "${site.name}" has the host "${host}", which names no single site. ` +
          "A host with no dot allows every address underneath it. Write the whole host, " +
          'for example "faq.example.com".',
      )
    // Being lenient about a scheme is kind, because it changes nothing. Being
    // lenient about a path is not: somebody who writes "example.com/cards"
    // wanted the read scoped to /cards, and the field cannot do that. Accepting
    // it silently leaves them believing a restriction that is not there.
    const raw = site.host.trim().replace(/^https?:\/\//, "")
    if (/[/\s]/.test(raw))
      throw new ReferenceFetchError(
        `The reference site "${site.name}" has the host "${site.host}", which holds a path or a space. ` +
          `This field takes a host and nothing else, such as "${host}". ` +
          "To keep a read inside one part of a site, list the parts to refuse in `disallowPaths`.",
      )
  }
}

/** The site an address belongs to, or null when no configured site owns it. */
export function siteFor(url: URL, sites: ReferenceSite[]): ReferenceSite | null {
  const host = url.hostname.toLowerCase()
  return (
    sites.find((site) => {
      const allowed = bareHost(site.host)
      // Equal, or a subdomain of it. The leading dot is what stops
      // "evilfaq.example.com" matching "faq.example.com": a bare suffix test
      // hands the allowlist to anybody who can register a longer name.
      return Boolean(allowed) && (host === allowed || host.endsWith(`.${allowed}`))
    }) ?? null
  )
}

/**
 * A refused or failed read of a reference page.
 *
 * Not called `ReferenceError`: that is a JavaScript built-in about an undefined
 * variable, and a catch block written for one would silently swallow the other.
 */
export class ReferenceFetchError extends Error {}

/**
 * Check one address against the allowlist and return the site that owns it.
 *
 * Rules 1, 2, and 3 of the ten live here, because those three must hold for a
 * redirect target as well as for the address the model first gave.
 */
function resolveTarget(raw: string, sites: ReferenceSite[]): { url: URL; site: ReferenceSite } {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new ReferenceFetchError(`"${raw}" is not an address.`)
  }
  // Rule 1. Only https. Plain http can be rewritten in transit, and every other
  // scheme reads something that is not a web page: file: reads this server's
  // disk, and a data: address is content the model wrote pretending to be a page.
  if (url.protocol !== "https:")
    throw new ReferenceFetchError(`Only https addresses may be read, and "${raw}" uses ${url.protocol}`)
  // Rule 2. The host must be one somebody configured.
  const site = siteFor(url, sites)
  if (!site)
    throw new ReferenceFetchError(
      `${url.hostname} is not a reference site. You may read only: ${sites.map((s) => s.host).join(", ")}.`,
    )
  // Rule 3. A prefix the operator refused. This sits beside the host check so
  // that a redirect meets it too: a site that disallows /api/ can otherwise
  // redirect a permitted address there.
  const path = url.pathname.toLowerCase()
  const refused = site.disallowPaths?.find((prefix) => path.startsWith(prefix.toLowerCase()))
  if (refused)
    throw new ReferenceFetchError(
      `${url.pathname} is under "${refused}", which ${site.name} does not allow a reader to fetch.`,
    )
  return { url, site }
}

/**
 * Read the body, stopping at `maxBytes`.
 *
 * The cap is applied WHILE reading, one chunk at a time. Reading the whole
 * response and trimming afterwards would bound what goes to the model and bound
 * nothing else: the bytes still cross the network and still sit in this
 * process's memory, so a page of any size could exhaust it.
 */
async function readCapped(response: Response, maxBytes: number): Promise<{ body: string; cut: boolean }> {
  const stream = response.body
  // A runtime that gives no readable stream cannot stop mid-response. Trimming
  // is all that is left, and it still bounds what the model is charged for.
  if (!stream) {
    const whole = await response.text()
    return { body: whole.slice(0, maxBytes), cut: whole.length > maxBytes }
  }
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let body = ""
  let read = 0
  let cut = false
  try {
    while (read < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      read += value.byteLength
      body += decoder.decode(value, { stream: true })
      if (read >= maxBytes) {
        cut = true
        break
      }
    }
  } finally {
    // Release the connection whether the read finished or the cap stopped it.
    await reader.cancel().catch(() => {})
  }
  // The last chunk overshoots, and a whole small page arrives as ONE chunk, so
  // stopping the reader bounds the network and bounds nothing else. Trimming
  // here is what bounds the text the model is charged for.
  if (body.length > maxBytes) {
    body = body.slice(0, maxBytes)
    cut = true
  }
  return { body, cut }
}

/**
 * Fetch one page from an allowlisted site.
 *
 * The ten rules, in the order they run:
 *
 * 1. The scheme must be https.
 * 2. The host must equal a configured host, or be one of its subdomains.
 * 3. The path must not start with a prefix the operator refused.
 * 4. Redirects are followed by hand, at most once, and only to an address that
 *    passes rules 2 and 3.
 * 5. No credentials, so nothing this server holds is sent to somebody's site.
 * 6. A timeout, so one slow site cannot hold a reader's question open.
 * 7. The content type must be readable text.
 * 8. A byte cap, applied WHILE reading rather than after.
 * 9. A per-turn count, enforced by the caller.
 * 10. A cache by address, so a popular page is read once.
 */
export async function fetchReference(
  raw: string,
  options: ReferenceOptions,
  seen = new Set<string>(),
): Promise<ReferencePage> {
  const { url, site } = resolveTarget(raw, options.sites)
  const doFetch = options.fetchImpl ?? globalThis.fetch
  if (!doFetch) throw new ReferenceFetchError("This runtime has no fetch, so no reference site can be read.")

  const response = await doFetch(url.toString(), {
    // Rule 4. Manual, so a redirect is checked against the allowlist before it
    // is followed. Letting fetch follow one lets a site send this server to an
    // address inside its own network, which is the whole of that attack.
    redirect: "manual",
    // Rule 5.
    credentials: "omit",
    // Rule 6.
    signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULTS.timeoutMs),
    headers: {
      accept: "text/html, text/plain;q=0.9",
      "user-agent": options.userAgent ?? DEFAULTS.userAgent,
    },
  })

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location")
    if (!location) throw new ReferenceFetchError(`${url.hostname} redirected without saying where.`)
    const next = new URL(location, url).toString()
    // One hop. A chain is a way to spend the timeout, and a loop is a way to
    // spend it forever.
    if (seen.size >= 1) throw new ReferenceFetchError(`${url.hostname} redirected more than once.`)
    seen.add(url.toString())
    return fetchReference(next, options, seen)
  }

  if (!response.ok) throw new ReferenceFetchError(`${url.toString()} answered ${response.status}.`)

  // Rule 7.
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase()
  if (!READABLE_TYPES.some((type) => contentType.includes(type)))
    throw new ReferenceFetchError(
      `${url.toString()} is ${contentType || "an unnamed type"}, which is not a readable page.`,
    )

  // Rule 8.
  const { body, cut } = await readCapped(response, options.maxBytes ?? DEFAULTS.maxBytes)
  const read = options.readPage ?? stripHtml
  return {
    site: site.name,
    url: url.toString(),
    title: pageTitle(body),
    text: read(body, contentType),
    official: site.official === true,
    truncated: cut,
  }
}

/**
 * The two tools an agent gets when an implementer configured a reference site.
 *
 * An empty site list returns no tools. A tool that can read nothing costs a step
 * and teaches the model that these tools return nothing, which is the same rule
 * that withholds a banned-list tool from a corpus with no banned list.
 *
 * CALL THIS ONCE PER TURN, not once per process. The fetch count lives in the
 * closure it returns, so a set of tools built once and reused would spend its
 * whole budget on the first question and refuse every question afterwards for
 * the life of the process. Building them is cheap: no store is read, and the
 * corpus tools that DO read one are still built once and cached.
 */
export function defineReferenceTools(options: ReferenceOptions): RuleTool[] {
  if (!options.sites.length) return []
  assertUsableSites(options.sites)

  const cap = options.maxFetchesPerTurn ?? DEFAULTS.maxFetchesPerTurn
  const hosts = options.sites.map((s) => s.host).join(", ")
  let used = 0

  const describe = (site: ReferenceSite) => ({
    name: site.name,
    host: site.host,
    describes: site.describes,
    official: site.official === true,
    ...(site.cardPath ? { page_pattern: `https://${site.host}${site.cardPath}` } : {}),
  })

  return [
    defineTool({
      name: "list_references",
      description:
        "Name the sites outside the rules data that you may read, and say what each one holds. Call " +
        "this when the corpus tools have missed. Naming a site the reader can check is often the " +
        "whole answer, and it costs no page read.",
      inputSchema: z.object({}),
      async execute() {
        return {
          sites: options.sites.map(describe),
          note:
            "These sites are not the rules data. A claim from one must say which site it came from " +
            "and whether that site is official.",
        }
      },
    }),
    defineTool({
      name: "fetch_reference",
      description:
        `Read one page from a reference site and return its text. Allowed hosts: ${hosts}. Use this ` +
        "ONLY after the corpus tools have missed, and at most " +
        `${cap} time${cap === 1 ? "" : "s"} per question. The page is NOT the rules data: quote it, ` +
        "name the site, and say the claim came from there.",
      inputSchema: z.object({
        url: z.string().min(1).describe(`The full https address. Its host must be one of: ${hosts}`),
      }),
      async execute(input) {
        // Rule 9. Counted before the read, so a refused call still costs one and
        // a model cannot retry its way past the cap.
        if (used >= cap) {
          return {
            error:
              `You have read ${used} reference page${used === 1 ? "" : "s"} for this question, which ` +
              "is the limit. Answer from what you have, and say what you could not check.",
          }
        }
        used += 1

        // Rule 10. Keyed by the address, so the same page costs one read however
        // many questions ask for it.
        const key = `rulekit:reference:${input.url}`
        const cached = await options.cache?.get<ReferencePage>(key).catch(() => null)
        if (cached) return cached

        try {
          const page = await fetchReference(input.url, options)
          await options.cache
            ?.set(key, page, options.cacheTtlSeconds ?? DEFAULTS.cacheTtlSeconds)
            .catch((err) => console.error("[rulekit] caching a reference page failed:", err))
          return page
        } catch (err) {
          // A refusal is an ordinary result, not a crash. The model reads it and
          // answers from the corpus, which is what it should have done anyway.
          return { error: err instanceof Error ? err.message : String(err) }
        }
      },
      describeResult(result) {
        const page = result as Partial<ReferencePage> | { error?: string } | null
        if (!page || typeof page !== "object") return undefined
        // A read that did not happen. The tool returns the refusal as an
        // ordinary result, so the runtime marks the step "completed", and the
        // reader watching the trace then sees a refused read reported as a
        // finished one. `rejected` is the true word, and it is what the
        // interface already counts and colours.
        if (!("url" in page) || !page.url) {
          return "error" in page && page.error
            ? { label: "Refused a reference read", kind: "read", status: "rejected" }
            : undefined
        }
        return {
          label: `Read ${page.site ?? "a reference site"}`,
          kind: "read",
          source: {
            name: String(page.site ?? "a reference site"),
            url: String(page.url),
            official: (page as ReferencePage).official === true,
          },
        }
      },
    }),
  ]
}
