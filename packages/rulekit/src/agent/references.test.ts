import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { MemoryCache } from "../pipeline/cache.ts"
import {
  defineReferenceTools,
  fetchReference,
  type ReferenceOptions,
  type ReferenceSite,
  siteFor,
  slugify,
  stripHtml,
} from "./references.ts"
import { findTool } from "./tools.ts"

/**
 * The reference tools, with no network.
 *
 * Every case below passes a stub fetch, so this file opens no socket and can
 * run in continuous integration beside the rest. That is also why `fetchImpl`
 * exists: a rule that can only be checked against a live site is a rule nobody
 * checks.
 *
 * The nine rules on `fetchReference` are what this file exists for. Each one
 * stops a specific way a model-chosen address turns a rules assistant into
 * something else, and each one has a case here.
 */

const SITE: ReferenceSite = {
  name: "Example FAQ",
  host: "faq.example.com",
  describes: "Community rulings for a game.",
  official: false,
  cardPath: "/cards/{slug}",
}

/** A stub fetch that answers from a table, and records what was asked for. */
function stubFetch(
  routes: Record<string, { status?: number; type?: string; body?: string; location?: string }>,
) {
  const asked: string[] = []
  const impl = (async (url: string | URL, init?: RequestInit) => {
    const key = String(url)
    asked.push(key)
    const route = routes[key]
    if (!route) return new Response("not found", { status: 404 })
    const headers = new Headers()
    if (route.type !== undefined) headers.set("content-type", route.type)
    else headers.set("content-type", "text/html; charset=utf-8")
    if (route.location) headers.set("location", route.location)
    // A redirect must reach the caller rather than being followed by the stub,
    // or this file would test the stub instead of the rule.
    void init
    return new Response(
      route.status && route.status >= 300 && route.status < 400 ? null : (route.body ?? ""),
      {
        status: route.status ?? 200,
        headers,
      },
    )
  }) as unknown as typeof fetch
  return { impl, asked }
}

const options = (over: Partial<ReferenceOptions> = {}): ReferenceOptions => ({
  sites: [SITE],
  ...over,
})

describe("choosing which site owns an address", () => {
  test("accepts the configured host", () => {
    assert.equal(siteFor(new URL("https://faq.example.com/cards/x"), [SITE])?.name, "Example FAQ")
  })

  test("accepts a subdomain of it", () => {
    assert.equal(siteFor(new URL("https://www.faq.example.com/x"), [SITE])?.name, "Example FAQ")
  })

  test("refuses a site list that would allow more than its author meant", () => {
    // `host: "com"` reads as "every address ending in .com", because a
    // subdomain of it is any host under it. Nobody writes that on purpose, and
    // nothing about it fails visibly at read time.
    assert.throws(() => defineReferenceTools({ sites: [{ ...SITE, host: "com" }] }), /names no single site/)
    assert.throws(
      () => defineReferenceTools({ sites: [{ ...SITE, host: "localhost" }] }),
      /names no single site/,
    )
    assert.throws(() => defineReferenceTools({ sites: [{ ...SITE, host: "  " }] }), /has no host/)
  })

  test("cleans a scheme, a path, and a port off a configured host", () => {
    for (const host of ["https://faq.example.com", "faq.example.com/cards", "faq.example.com:443"]) {
      assert.equal(
        siteFor(new URL("https://faq.example.com/x"), [{ ...SITE, host }])?.name,
        "Example FAQ",
        `"${host}" must still name the same site`,
      )
    }
  })

  test("refuses a host that merely ends with the same letters", () => {
    // "evilfaq.example.com" ends with "faq.example.com" as a STRING and is a
    // different host. Matching on a bare suffix hands an attacker the allowlist.
    assert.equal(siteFor(new URL("https://evilfaq.example.com/x"), [SITE]), null)
    assert.equal(siteFor(new URL("https://faq.example.com.attacker.test/x"), [SITE]), null)
  })
})

describe("the fetch rules", () => {
  test("rule 1: refuses anything that is not https", async () => {
    for (const url of ["http://faq.example.com/x", "file:///etc/passwd", "ftp://faq.example.com/x"]) {
      await assert.rejects(
        fetchReference(url, options({ fetchImpl: stubFetch({}).impl })),
        /Only https/,
        `${url} must be refused`,
      )
    }
  })

  test("rule 2: refuses a host nobody configured, and names the ones allowed", async () => {
    await assert.rejects(
      fetchReference("https://somewhere.else.test/x", options({ fetchImpl: stubFetch({}).impl })),
      /not a reference site.*faq\.example\.com/s,
    )
  })

  test("rule 2: refuses an address inside this network", async () => {
    // The classic escape. An assistant that reads an internal address becomes a
    // way to read the network it runs in.
    await assert.rejects(
      fetchReference("https://169.254.169.254/latest/meta-data/", options({ fetchImpl: stubFetch({}).impl })),
      /not a reference site/,
    )
  })

  test("rule 3: follows one redirect that stays on the allowlist", async () => {
    const { impl, asked } = stubFetch({
      "https://faq.example.com/old": { status: 301, location: "https://faq.example.com/new" },
      "https://faq.example.com/new": { body: "<html><title>New</title><p>Text here.</p></html>" },
    })
    const page = await fetchReference("https://faq.example.com/old", options({ fetchImpl: impl }))
    assert.equal(page.url, "https://faq.example.com/new")
    assert.match(page.text, /Text here/)
    assert.deepEqual(asked, ["https://faq.example.com/old", "https://faq.example.com/new"])
  })

  test("rule 3: refuses a redirect that leaves the allowlist", async () => {
    // A site this project does not control decides where its redirects point,
    // so following one blindly hands that site the allowlist.
    const { impl, asked } = stubFetch({
      "https://faq.example.com/away": { status: 302, location: "https://169.254.169.254/latest/" },
    })
    await assert.rejects(
      fetchReference("https://faq.example.com/away", options({ fetchImpl: impl })),
      /not a reference site/,
    )
    assert.deepEqual(asked, ["https://faq.example.com/away"], "the second address must never be requested")
  })

  test("rule 3: refuses a chain of redirects", async () => {
    const { impl } = stubFetch({
      "https://faq.example.com/a": { status: 302, location: "https://faq.example.com/b" },
      "https://faq.example.com/b": { status: 302, location: "https://faq.example.com/c" },
      "https://faq.example.com/c": { body: "<p>End.</p>" },
    })
    await assert.rejects(
      fetchReference("https://faq.example.com/a", options({ fetchImpl: impl })),
      /redirected more than once/,
    )
  })

  test("rules 4 and 5: sends no credentials, follows no redirect itself, and carries a deadline", async () => {
    let seen: RequestInit | undefined
    const impl = (async (_url: string | URL, init?: RequestInit) => {
      seen = init
      return new Response("<p>Hello.</p>", { headers: { "content-type": "text/html" } })
    }) as unknown as typeof fetch
    await fetchReference("https://faq.example.com/x", options({ fetchImpl: impl }))
    assert.equal(seen?.credentials, "omit")
    assert.equal(seen?.redirect, "manual")
    assert.ok(seen?.signal, "a fetch with no deadline can hold a reader's question open forever")
    const headers = (seen?.headers ?? {}) as Record<string, string>
    assert.match(headers["user-agent"] ?? "", /rulekit/)
  })

  test("rule 6: cuts an oversized page and says it did", async () => {
    const huge = `<p>${"word ".repeat(20_000)}</p>`
    const { impl } = stubFetch({ "https://faq.example.com/big": { body: huge } })
    const page = await fetchReference(
      "https://faq.example.com/big",
      options({ fetchImpl: impl, maxBytes: 500 }),
    )
    assert.equal(page.truncated, true)
    assert.ok(page.text.length <= 500, `expected at most 500 characters, got ${page.text.length}`)
  })

  test("rule 7: refuses a response that is not a readable page", async () => {
    const { impl } = stubFetch({
      "https://faq.example.com/x.pdf": { type: "application/pdf", body: "%PDF-1.7" },
    })
    await assert.rejects(
      fetchReference("https://faq.example.com/x.pdf", options({ fetchImpl: impl })),
      /not a readable page/,
    )
  })

  test("reports a failing status rather than treating the error page as an answer", async () => {
    const { impl } = stubFetch({ "https://faq.example.com/gone": { status: 404, body: "<p>Nope</p>" } })
    await assert.rejects(fetchReference("https://faq.example.com/gone", options({ fetchImpl: impl })), /404/)
  })
})

describe("the reference tools", () => {
  test("offers no tool when no site is configured", () => {
    // The same rule that withholds a banned-list tool from a corpus with no
    // banned list. A tool that can read nothing costs a step and teaches the
    // model that these tools return nothing.
    assert.deepEqual(defineReferenceTools({ sites: [] }), [])
  })

  test("offers both tools when a site is configured", () => {
    const names = defineReferenceTools(options()).map((t) => t.name)
    assert.deepEqual(names, ["list_references", "fetch_reference"])
  })

  test("names every site and whether it is official, without reading a page", async () => {
    const { impl, asked } = stubFetch({})
    const tool = findTool(defineReferenceTools(options({ fetchImpl: impl })), "list_references")
    const result = (await tool?.execute({} as never)) as {
      sites: { name: string; official: boolean; page_pattern?: string }[]
    }
    assert.equal(result.sites[0]?.name, "Example FAQ")
    assert.equal(result.sites[0]?.official, false)
    assert.equal(result.sites[0]?.page_pattern, "https://faq.example.com/cards/{slug}")
    assert.deepEqual(asked, [], "naming the sites must cost no page read")
  })

  test("rule 8: stops at the per-question cap", async () => {
    const { impl, asked } = stubFetch({
      "https://faq.example.com/a": { body: "<p>A</p>" },
      "https://faq.example.com/b": { body: "<p>B</p>" },
      "https://faq.example.com/c": { body: "<p>C</p>" },
      "https://faq.example.com/d": { body: "<p>D</p>" },
    })
    const tool = findTool(
      defineReferenceTools(options({ fetchImpl: impl, maxFetchesPerTurn: 3 })),
      "fetch_reference",
    )
    for (const path of ["a", "b", "c"]) {
      const page = (await tool?.execute({ url: `https://faq.example.com/${path}` } as never)) as {
        error?: string
      }
      assert.equal(page.error, undefined)
    }
    const fourth = (await tool?.execute({ url: "https://faq.example.com/d" } as never)) as { error?: string }
    assert.match(fourth.error ?? "", /limit/)
    assert.equal(asked.length, 3, "the fourth address must never be requested")
  })

  test("rule 8: a refused address still spends its share of the cap", async () => {
    // Otherwise a model retries its way past the limit by aiming at hosts that
    // fail, and each failure costs a round trip anyway.
    const { impl } = stubFetch({ "https://faq.example.com/a": { body: "<p>A</p>" } })
    const tool = findTool(
      defineReferenceTools(options({ fetchImpl: impl, maxFetchesPerTurn: 1 })),
      "fetch_reference",
    )
    const refused = (await tool?.execute({ url: "https://elsewhere.test/x" } as never)) as { error?: string }
    assert.match(refused.error ?? "", /not a reference site/)
    const next = (await tool?.execute({ url: "https://faq.example.com/a" } as never)) as { error?: string }
    assert.match(next.error ?? "", /limit/)
  })

  test("builds a fresh cap for each turn's tools", async () => {
    // The count lives in the closure, so one set of tools reused across turns
    // would spend its budget once and refuse every question afterwards.
    const { impl } = stubFetch({ "https://faq.example.com/a": { body: "<p>A</p>" } })
    const build = () =>
      findTool(defineReferenceTools(options({ fetchImpl: impl, maxFetchesPerTurn: 1 })), "fetch_reference")
    await build()?.execute({ url: "https://faq.example.com/a" } as never)
    const second = (await build()?.execute({ url: "https://faq.example.com/a" } as never)) as {
      error?: string
    }
    assert.equal(second.error, undefined, "a new turn must start with a full budget")
  })

  test("rule 9: reads one address once and serves the rest from the cache", async () => {
    const { impl, asked } = stubFetch({ "https://faq.example.com/a": { body: "<p>A</p>" } })
    const cache = new MemoryCache()
    const call = async () => {
      const tool = findTool(defineReferenceTools(options({ fetchImpl: impl, cache })), "fetch_reference")
      return (await tool?.execute({ url: "https://faq.example.com/a" } as never)) as { text?: string }
    }
    const first = await call()
    const second = await call()
    assert.equal(first.text, second.text)
    assert.deepEqual(asked, ["https://faq.example.com/a"], "the second read must come from the cache")
  })

  test("returns a refusal to the model rather than throwing", async () => {
    // A refused address is an ordinary result. Throwing would end the turn, and
    // the reader would get a failure where a corpus answer was still possible.
    const tool = findTool(defineReferenceTools(options({ fetchImpl: stubFetch({}).impl })), "fetch_reference")
    const result = (await tool?.execute({ url: "http://faq.example.com/x" } as never)) as { error?: string }
    assert.match(result.error ?? "", /Only https/)
  })

  test("marks a successful read as coming from outside the corpus", async () => {
    // This is what the interface renders. The model writes the prose and the
    // model is the thing being checked, so the marker cannot come from prose.
    const { impl } = stubFetch({
      "https://faq.example.com/cards/x": { body: "<html><title>X</title><p>Body.</p></html>" },
    })
    const tool = findTool(defineReferenceTools(options({ fetchImpl: impl })), "fetch_reference")
    const result = await tool?.execute({ url: "https://faq.example.com/cards/x" } as never)
    assert.deepEqual(tool?.describeResult?.(result)?.source, {
      name: "Example FAQ",
      url: "https://faq.example.com/cards/x",
      official: false,
    })
  })

  test("marks nothing when the read failed", async () => {
    const tool = findTool(defineReferenceTools(options({ fetchImpl: stubFetch({}).impl })), "fetch_reference")
    const result = await tool?.execute({ url: "https://elsewhere.test/x" } as never)
    assert.equal(tool?.describeResult?.(result), undefined)
  })
})

describe("reading a page without an HTML parser", () => {
  test("drops the furniture and keeps the article", () => {
    const text = stripHtml(
      "<html><head><title>Promising Future</title><style>p{color:red}</style></head>" +
        "<body><nav>Home Cards</nav><script>track()</script>" +
        "<p>How does it resolve?</p><p>In two passes.</p><footer>Contact</footer></body></html>",
    )
    assert.match(text, /Promising Future/)
    assert.match(text, /How does it resolve\?/)
    assert.match(text, /In two passes\./)
    assert.ok(!text.includes("track()"), "script contents are never the article")
    assert.ok(!text.includes("color:red"), "style contents are never the article")
    assert.ok(!text.includes("Home Cards"), "navigation is never the article")
  })

  test("keeps words on either side of a block from running together", () => {
    assert.match(stripHtml("<li>Guard</li><li>Swift</li>"), /Guard\nSwift/)
  })

  test("decodes the entities a rules page actually uses", () => {
    assert.equal(stripHtml("<p>A &amp; B &lt; C &quot;D&quot;</p>"), 'A & B < C "D"')
  })

  test("passes plain text through untouched", () => {
    assert.equal(stripHtml("Rule 300.2 <not a tag>", "text/plain"), "Rule 300.2 <not a tag>")
  })

  test("uses a reader the implementer supplied instead", async () => {
    const { impl } = stubFetch({ "https://faq.example.com/x": { body: "<p>ignored</p>" } })
    const page = await fetchReference(
      "https://faq.example.com/x",
      options({ fetchImpl: impl, readPage: () => "my own reading" }),
    )
    assert.equal(page.text, "my own reading")
  })
})

describe("slugify", () => {
  test("turns a printed name into a path segment", () => {
    assert.equal(slugify("Promising Future"), "promising-future")
    assert.equal(slugify("Stonewall Sentry, Awakened"), "stonewall-sentry-awakened")
    assert.equal(slugify("  Ka'Tel's Oath  "), "ka-tel-s-oath")
  })
})
