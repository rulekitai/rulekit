import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { after, before, describe, test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import { loadCorpus } from "../corpus/load.ts"
import {
  AGENT_README_SECTION,
  AGENT_README_URL,
  checkProfileFields,
  commandAsk,
  commandBuild,
  commandInit,
  commandValidate,
  isMainModule,
  packageVersion,
  SHIPPED_CORPORA,
} from "./bin.ts"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..")
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

/**
 * Run a command with stdout captured. Returns the exit code and what it printed.
 *
 * WHAT IT RETURNS MAY HOLD MORE THAN THE COMMAND WROTE. This replaces
 * `process.stdout.write` for everybody, and the test runner writes its own
 * report through the same function, so anything the runner announces inside the
 * window lands in the captured text. Assert with a regular expression, which
 * steps over that. A test that needs the exact output runs the command in its
 * own process instead. See "the command as a program" below.
 */
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

  test("a miss names a README section that the README actually has", async () => {
    // This message once sent the reader to a section called "Run it". No README
    // has had that heading for some time, so the reader arrived nowhere. The
    // test reads the headings out of the README rather than trusting the name.
    const readme = await readFile(resolve(ROOT, "README.md"), "utf8")
    const headings = [...readme.matchAll(/^#+\s+(.+)$/gm)].map((match) => match[1]?.trim())
    assert.ok(
      headings.includes(AGENT_README_SECTION),
      `README.md has no heading "${AGENT_README_SECTION}". It has: ${headings.join(", ")}`,
    )

    const { out } = await run(() => commandAsk(DEMO, "how do Guard and Swift interact"))
    assert.match(out, new RegExp(AGENT_README_SECTION))
    assert.match(out, new RegExp(AGENT_README_URL.replace(/[.#/]/g, "\\$&")))
  })
})

/**
 * The `--json` answer, checked by running the command as a program.
 *
 * These tests do not use the capture helper above. That helper replaces
 * `process.stdout.write` for everybody, and the test runner writes its own
 * report through the same function, so a capture window holds whatever the
 * runner happened to announce inside it. A regular expression steps over that
 * noise; `JSON.parse` cannot, and must not, because the promise this flag makes
 * is that the whole output is one object.
 *
 * Running the command in its own process is also the only way to test the
 * argument parsing, which is where a flag either reaches its command or does
 * not.
 */
describe("the command as a program", () => {
  const BIN = resolve(ROOT, "packages/rulekit/src/cli/bin.ts")

  /** Run the command in its own process. Node strips the types as it loads them. */
  async function command(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((done) => {
      const child = execFile(process.execPath, [BIN, ...args], (error, stdout, stderr) => {
        done({ code: error && typeof error.code === "number" ? error.code : 0, stdout, stderr })
      })
      child.on("error", () => done({ code: 1, stdout: "", stderr: "spawn failed" }))
    })
  }

  test("--version prints the version and nothing else", async () => {
    const { code, stdout } = await command("--version")
    assert.equal(code, 0)
    assert.equal(stdout.trim(), packageVersion())
  })

  test("--json prints one object a script can read, and nothing else", async () => {
    const { code, stdout } = await command("ask", DEMO, "what does rule 300.2.a say", "--json")
    assert.equal(code, 0)
    const answer = JSON.parse(stdout)
    assert.equal(answer.answered, true)
    assert.equal(answer.servedBy, "static")
    assert.match(answer.text, /Guard/)
    assert.ok(Array.isArray(answer.citations))
    // The cost of an answer belongs to the operator, so it is left out here
    // for the same reason the HTTP handler leaves it out.
    assert.equal("usage" in answer, false)
  })

  test("--json reports a miss as data too, rather than as prose", async () => {
    const { stdout } = await command("ask", DEMO, "what does rule 999.9 say", "--json")
    const answer = JSON.parse(stdout)
    assert.equal(answer.answered, false)
    assert.equal(answer.missingRule, "999.9")
    assert.ok(answer.trace.some((step: { stage: string }) => step.stage === "static"))
  })

  test("--json stays parsable when the corpus has no profile", async () => {
    // The note about a missing profile is for a person. Printed as it is, it
    // would sit in front of the object and every parser would fail on it.
    const dir = await corpusWith("no-profile-json")
    await rm(join(dir, "profile.json"))
    const { stdout } = await command("ask", dir, "what does rule 300.2.a say", "--json")
    assert.equal(JSON.parse(stdout).answered, true)
  })

  test("prints no experimental warning about SQLite", async () => {
    // Node marks its own SQLite module experimental and announces it before
    // anything the reader asked for. The command hides that one warning.
    const { stderr } = await command("ask", DEMO, "what does rule 300.2.a say")
    assert.doesNotMatch(stderr, /ExperimentalWarning/)
  })

  test("init copies the corpus that --corpus names", async () => {
    const dir = join(scratch, "argv-corpus")
    const { code, stdout } = await command("init", dir, "--corpus", "chess")
    assert.equal(code, 0)
    assert.match(stdout, /chess/)
    assert.ok(existsSync(join(dir, "game.json")))
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

  test("every document it names is a full address", async () => {
    // A reader who installed from npm holds no docs/ directory. A bare path
    // told them to open a file that their computer does not have.
    const dir = join(scratch, "full-addresses")
    const { out } = await run(() => commandInit(dir))
    assert.doesNotMatch(out, /(^|[^/\w])docs\//)
    assert.match(out, /https:\/\/github\.com\/rulekitai\/rulekit/)
  })

  test("copies any corpus the package ships, not only the demo", async () => {
    // The skills promised five corpora and the package held one, so anybody
    // building a real assistant had to clone this repository to find the rest.
    for (const corpus of SHIPPED_CORPORA) {
      const dir = join(scratch, `shipped-${corpus}`)
      assert.equal((await run(() => commandInit(dir, corpus))).code, 0, corpus)
      assert.equal((await run(() => commandValidate(dir))).code, 0, corpus)
    }
  })

  test("copies no compiled database, so the rules and the answers agree", async () => {
    // A database compiled from an older copy of the JSON answers, and answers
    // with rules that the files beside it no longer state.
    const dir = join(scratch, "no-database")
    await run(() => commandInit(dir))
    assert.equal(existsSync(join(dir, "corpus.db")), false)
  })

  test("names what it holds when the corpus is not one of them", async () => {
    const dir = join(scratch, "unknown-corpus")
    const { code, out } = await run(() => commandInit(dir, "monopoly"))
    assert.equal(code, 1)
    for (const corpus of SHIPPED_CORPORA) assert.match(out, new RegExp(corpus))
    // Riftbound is the one somebody asks for and cannot have, so say where it is.
    assert.match(out, /riftbound/i)
    assert.equal(existsSync(dir), false)
  })
})

describe("--version", () => {
  test("reports the version in this package's manifest", async () => {
    // A script pins a version and checks it. Reading the manifest through the
    // same relative path the compiled command uses is what this guards.
    const manifest = JSON.parse(await readFile(resolve(ROOT, "packages/rulekit/package.json"), "utf8"))
    assert.equal(packageVersion(), manifest.version)
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

describe("isMainModule", () => {
  test("recognises the file when it runs through a symlink, as npm installs it", async () => {
    // npm puts a `bin` in node_modules/.bin as a SYMLINK to the real file, so
    // argv[1] is the link and import.meta.url is its target. Comparing them
    // unresolved made every published command exit 0 and print nothing.
    const real = join(scratch, "real-bin.js")
    const link = join(scratch, "linked-bin")
    await writeFile(real, "// the command\n")
    await symlink(real, link)

    assert.equal(isMainModule(link, pathToFileURL(realpathSync(real)).href), true)
  })

  test("recognises the file when it runs by its own path", async () => {
    const real = join(scratch, "plain-bin.js")
    await writeFile(real, "// the command\n")
    assert.equal(isMainModule(real, pathToFileURL(realpathSync(real)).href), true)
  })

  test("says no for a different file, so an import never runs the program", async () => {
    const real = join(scratch, "other-bin.js")
    await writeFile(real, "// a different file\n")
    assert.equal(isMainModule(real, pathToFileURL(join(scratch, "not-me.js")).href), false)
    assert.equal(isMainModule(undefined, "file:///anything"), false)
  })

  test("compares a path that cannot be resolved rather than throwing", async () => {
    const missing = join(scratch, "no-such-file.js")
    assert.equal(isMainModule(missing, pathToFileURL(missing).href), true)
  })
})
