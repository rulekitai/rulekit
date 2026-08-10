import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { after, before, describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadCorpus } from "@rulekitai/corpus/load"
import { checkProfileFields, commandAsk, commandBuild, commandInit, commandValidate } from "./bin.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")
const DEMO = resolve(ROOT, "data/demo")

/**
 * The command-line tool, tested by calling its commands directly.
 *
 * Every broken corpus below is built in a temporary directory rather than
 * committed. A committed broken corpus is something somebody will later find and
 * try to fix, and then the test that needed it silently stops testing anything.
 *
 * Output goes to stdout, which is noise in a test run. Each test captures it,
 * because the exit code is what matters and a wall of validation output buries
 * the failures.
 */

let scratch: string

/** Run a command with stdout captured. Returns the exit code and what it printed. */
async function run(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const original = process.stdout.write.bind(process.stdout)
  let captured = ""
  // A narrower signature than the real one, which is all these commands use.
  process.stdout.write = ((chunk: string) => {
    captured += chunk
    return true
  }) as typeof process.stdout.write
  const originalError = process.stderr.write.bind(process.stderr)
  process.stderr.write = ((chunk: string) => {
    captured += chunk
    return true
  }) as typeof process.stderr.write
  try {
    const code = await fn()
    return { code, out: captured }
  } finally {
    process.stdout.write = original
    process.stderr.write = originalError
  }
}

/** Copy the demo corpus, then let a test break one file in it. */
async function corpusWith(name: string, edit?: (corpus: Record<string, unknown>) => void): Promise<string> {
  const dir = join(scratch, name)
  await cp(DEMO, dir, { recursive: true })
  if (edit) {
    const file = join(dir, "rules.json")
    const parsed = JSON.parse(await readFile(file, "utf8"))
    edit(parsed)
    await writeFile(file, JSON.stringify(parsed, null, 2))
  }
  return dir
}

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), "rulekit-cli-"))
})

after(async () => {
  await rm(scratch, { recursive: true, force: true })
})

describe("validate", () => {
  test("accepts the demo corpus", async () => {
    const { code, out } = await run(() => commandValidate(DEMO))
    assert.equal(code, 0)
    assert.match(out, /Valid\./)
    assert.match(out, /Paper Kingdoms/)
  })

  test("reports the counts, so a truncated corpus is visible", async () => {
    const { out } = await run(() => commandValidate(DEMO))
    assert.match(out, /rules\s+27/)
    assert.match(out, /cards\s+12/)
  })

  test("fails a corpus whose rule points at a parent that does not exist", async () => {
    // The failure that matters most: the hierarchy tools walk this link, and a
    // broken one silently truncates a branch of the rulebook.
    const dir = await corpusWith("dangling", (corpus) => {
      const items = corpus.items as { id: string; parent_id: string | null }[]
      const child = items.find((r) => r.parent_id)
      assert.ok(child)
      child.parent_id = "no-such-rule"
    })
    const { code, out } = await run(() => commandValidate(dir))
    assert.equal(code, 1)
    assert.match(out, /parent_id "no-such-rule" names no rule/)
  })

  test("fails a parent chain that forms a cycle rather than hanging on it", async () => {
    const dir = await corpusWith("cycle", (corpus) => {
      const items = corpus.items as { id: string; parent_id: string | null }[]
      const a = items[0] as { id: string; parent_id: string | null }
      const b = items[1] as { id: string; parent_id: string | null }
      a.parent_id = b.id
      b.parent_id = a.id
    })
    const { code, out } = await run(() => commandValidate(dir))
    assert.equal(code, 1)
    assert.match(out, /cycle/)
  })

  test("fails a corpus that holds no rules at all", async () => {
    // It parses fine and answers nothing, which is the one failure nobody
    // notices until the assistant is deployed.
    const dir = await corpusWith("empty", (corpus) => {
      corpus.items = []
    })
    const { code, out } = await run(() => commandValidate(dir))
    assert.equal(code, 1)
    assert.match(out, /holds no rules/)
  })

  test("fails a corpus whose version it does not understand", async () => {
    const dir = await corpusWith("version")
    const file = join(dir, "rules.json")
    const parsed = JSON.parse(await readFile(file, "utf8"))
    parsed.schemaVersion = 99
    await writeFile(file, JSON.stringify(parsed))
    const { code, out } = await run(() => commandValidate(dir))
    assert.equal(code, 1)
    assert.match(out, /schemaVersion 99/)
  })

  test("fails a directory that is not a corpus", async () => {
    const { code } = await run(() => commandValidate(join(scratch, "nothing-here")))
    assert.equal(code, 1)
  })

  test("names the row that is wrong, not just the file", async () => {
    const dir = await corpusWith("badrow", (corpus) => {
      // Replace the row with a copy that has no id. The field must be ABSENT,
      // not undefined, because that is what a hand-written corpus looks like.
      const items = corpus.items as Record<string, unknown>[]
      const { id: _id, ...withoutId } = items[3] as Record<string, unknown>
      items[3] = withoutId
    })
    const { code, out } = await run(() => commandValidate(dir))
    assert.equal(code, 1)
    assert.match(out, /\[item 3\]/)
  })
})

describe("build", () => {
  test("compiles a corpus and reports where it went", async () => {
    const dir = await corpusWith("build-ok")
    const { code, out } = await run(() => commandBuild(dir, null))
    assert.equal(code, 0)
    assert.match(out, /Wrote/)
    assert.ok(existsSync(join(dir, "corpus.db")))
  })

  test("replaces an existing database rather than failing on it", async () => {
    // A build REPLACES; it does not add. The first version of this failed on a
    // second run with "table meta already exists".
    const dir = await corpusWith("build-twice")
    assert.equal((await run(() => commandBuild(dir, null))).code, 0)
    const { code } = await run(() => commandBuild(dir, null))
    assert.equal(code, 0)
  })

  test("writes where it is told", async () => {
    const dir = await corpusWith("build-out")
    const target = join(scratch, "elsewhere.db")
    assert.equal((await run(() => commandBuild(dir, target))).code, 0)
    assert.ok(existsSync(target))
  })

  test("refuses to build a corpus it could not read", async () => {
    const { code, out } = await run(() => commandBuild(join(scratch, "not-a-corpus"), null))
    assert.equal(code, 1)
    assert.match(out, /rulekit validate/)
  })
})

describe("ask", () => {
  test("answers a rule question from the rows, with no model", async () => {
    const { code, out } = await run(() => commandAsk(DEMO, "what does rule 300.2.a say"))
    assert.equal(code, 0)
    assert.match(out, /served by static/)
    assert.match(out, /Guard/)
  })

  test("answers a definition question from the glossary", async () => {
    const { out } = await run(() => commandAsk(DEMO, "what is Swift"))
    assert.match(out, /served by glossary/)
  })

  test("says plainly when no free stage can answer, and names what it tried", async () => {
    // Reporting the miss is the honest result. A command that printed nothing
    // would read as a broken corpus.
    const { code, out } = await run(() =>
      commandAsk(DEMO, "how do Guard and Swift interact when blocking an unblockable unit"),
    )
    assert.equal(code, 0)
    assert.match(out, /No free stage could answer/)
    assert.match(out, /static=passed/)
  })

  test("a miss shows a question of each shape that this corpus does answer", async () => {
    // Without an example, the next attempt is a guess. The examples come from
    // the corpus in front of the reader, so both of them work as printed.
    const { out } = await run(() => commandAsk(DEMO, "how do Guard and Swift interact"))
    assert.match(out, /rulekit ask .*"what does rule [\d.a-z]+ say"/)
    assert.match(out, /rulekit ask .*"what is .+"/)
  })

  test("names a rule number the corpus does not hold, rather than reporting a plain miss", async () => {
    // A wrong rule number and a question of the wrong shape both leave every
    // stage passed. Saying which one happened is what stops a retry of the same
    // wrong number.
    const { code, out } = await run(() => commandAsk(DEMO, "what does rule 999.9 say"))
    assert.equal(code, 0)
    assert.match(out, /holds no rule 999\.9/)
  })

  test("still answers a corpus that has no profile", async () => {
    const dir = await corpusWith("no-profile")
    await rm(join(dir, "profile.json"))
    const { code, out } = await run(() => commandAsk(dir, "what does rule 300.2.a say"))
    assert.equal(code, 0)
    assert.match(out, /no profile\.json/)
    assert.match(out, /Rule 300\.2\.a/)
  })
})

describe("init", () => {
  test("copies a corpus that then validates and builds", async () => {
    // The whole point of `init`: what it hands somebody must actually work,
    // or the first thing they do is debug the example.
    const dir = join(scratch, "brand-new")
    assert.equal((await run(() => commandInit(dir))).code, 0)
    assert.equal((await run(() => commandValidate(dir))).code, 0)
    assert.equal((await run(() => commandBuild(dir, null))).code, 0)
  })

  test("tells the reader what to do next", async () => {
    const dir = join(scratch, "next-steps")
    const { out } = await run(() => commandInit(dir))
    assert.match(out, /rulekit validate/)
    assert.match(out, /corpus-format\.md/)
  })
})

describe("a profile that names a field no card carries", () => {
  test("the shipped demo profile names only fields that exist", async () => {
    const result = await loadCorpus(DEMO)
    assert.ok(result.ok)
    assert.deepEqual(checkProfileFields(DEMO, result.corpus), [])
  })

  test("names the field and suggests the near miss", async () => {
    // textFields and statFields are references into the data, and nothing else
    // checks them. A typo is silent twice: the assistant hears about a field
    // that does not exist, and never hears about the one that does.
    const dir = await mkdtemp(join(tmpdir(), "rulekit-profile-"))
    await cp(DEMO, dir, { recursive: true })
    const profile = JSON.parse(await readFile(join(dir, "profile.json"), "utf8"))
    profile.cards.textFields.push({ field: "card_txt", describes: "a typo" })
    await writeFile(join(dir, "profile.json"), JSON.stringify(profile))

    const result = await loadCorpus(dir)
    assert.ok(result.ok)
    const problems = checkProfileFields(dir, result.corpus)
    assert.equal(problems.length, 1)
    assert.match(problems[0]?.message ?? "", /card_txt/)
    assert.match(problems[0]?.message ?? "", /Did you mean "card_text"/)
    await rm(dir, { recursive: true, force: true })
  })

  test("a corpus with no profile is still valid", async () => {
    const result = await loadCorpus(DEMO)
    assert.ok(result.ok)
    assert.deepEqual(checkProfileFields("/no/such/directory", result.corpus), [])
  })
})
