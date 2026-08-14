#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { argv, cwd, exit, stderr, stdout } from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { type Profile, parseProfile } from "../agent/profile.ts"
import { buildDatabase } from "../corpus/build.ts"
import { type CorpusProblem, checkIntegrity, loadCorpus } from "../corpus/load.ts"
import { KNOWN_CORPUS_FILES } from "../corpus/schema.ts"
import { SqliteStore } from "../corpus/sqlite-store.ts"
import type { Corpus } from "../corpus/types.ts"
import { DEFAULT_CREDENTIAL_VARIABLE } from "../pipeline/gate.ts"
import { hideSqliteExperimentalWarning } from "../sqlite-warning.ts"

/**
 * The `rulekit` command.
 *
 * Four things, and no more. There is no `import` and no `fetch`: this project
 * does no data collection, so a corpus arrives already written and the command
 * only ever reads, checks, and compiles one.
 */

type Problem = CorpusProblem

/**
 * Where this command writes, as one object a test can replace.
 *
 * A TEST MUST NOT REPLACE `process.stdout.write` TO READ WHAT A COMMAND PRINTS.
 * The test runner reports its own results through that same function, so a
 * replacement swallows them: the run prints fewer results than it ran, and the
 * summary counts fewer than it ran. Fifteen tests in `bin.test.ts` were
 * invisible that way, and a deliberately broken one still printed "fail 0".
 * Only the exit code stayed honest.
 */
export const output = {
  write: (text: string) => void stdout.write(text),
  writeError: (text: string) => void stderr.write(text),
}

const out = (line = "") => output.write(`${line}\n`)
const err = (line: string) => output.writeError(`${line}\n`)

// A command is a program, so it decides which warnings it prints. See the
// module for why this is not the library's decision to make.
hideSqliteExperimentalWarning()

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * The corpora that ship inside the package, newest reader first.
 *
 * All four carry a CC0 1.0 dedication, so anybody may copy one and sell what
 * they build on it. The Riftbound corpus is not here and never will be: Riot
 * Games owns that data, and their policy permits non-commercial use only.
 */
const SHIPPED_CORPORA = ["demo", "chess", "texas-holdem", "estate-line"] as const

/**
 * Where `rulekit init` copies a corpus from.
 *
 * Two places, and the first that exists wins. An installed package holds its
 * own copy under `data/`, which the build puts there, because npm ships only
 * files from inside the package directory. A checkout of this repository reads
 * the originals at the root, so `init` works before anybody runs a build, and
 * `--corpus riftbound` works there too.
 *
 * An earlier version resolved one path relative to the repository root. It
 * worked in the repository and pointed at nothing after an install from npm,
 * so `init` copied nothing and reported success.
 */
const CORPUS_ROOTS = [
  resolve(HERE, "../../data"), // inside the installed or built package
  resolve(HERE, "../../../../data"), // this repository, running from src
]

/** The version of this package, which a script may need to report. */
function packageVersion(): string {
  // Both the compiled command and the source command sit two directories below
  // the package root, so one path serves both.
  const manifest = JSON.parse(readFileSync(resolve(HERE, "../../package.json"), "utf8")) as {
    version: string
  }
  return manifest.version
}

/** The corpus format, at an address that a reader outside this repository can open. */
const CORPUS_FORMAT_DOC = "https://github.com/rulekitai/rulekit/blob/main/docs/corpus-format.md"

/**
 * The README section that shows how to serve an agent, and its address.
 *
 * A message once sent a reader to a section called "Run it". No README has had
 * that heading for some time, so the reader arrived nowhere. A test beside this
 * file reads the headings out of the README and fails if this pair drifts
 * again. The full address is here because a reader who installed from npm holds
 * no copy of the README this names.
 */
export const AGENT_README_SECTION = "Put it in your application"
export const AGENT_README_URL = "https://github.com/rulekitai/rulekit#put-it-in-your-application"

const USAGE = `rulekit — a grounded rules assistant over your own corpus

Usage:
  rulekit validate <dir>          Check a corpus and name every problem
  rulekit build <dir> [--out f]   Compile a corpus to a SQLite database
  rulekit init <dir> [--corpus c] Copy a corpus as a starting point.
                                  Default demo. One of: ${SHIPPED_CORPORA.join(", ")}.
  rulekit ask <dir> "<question>"  Ask a rule-number or keyword question, with no
    [--json]                      model. This runs the free stages only, so it
                                  never reaches the agent. Use it to check a
                                  corpus, not to ask the whole range of
                                  questions a served assistant answers.
                                  --json prints one JSON object, for a script.
  rulekit eval <dir> [options]    Run the corpus's eval.json through the agent
                                  and check nothing was invented. Needs a model
                                  credential. Exits non-zero on any fabrication.
  rulekit --version               Print the version of this package

eval options:
  --model <id>     Model to grade. Default anthropic/claude-sonnet-5.
  --out <file>     Write full results as JSON.
  --only <text>    Run only questions whose id or category contains this.
  --step-cap <n>   Cap model calls per question. Default none, as in production.
  --regrade <file> Grade a previous run's answers again, with no model calls.

Every corpus is a directory of JSON files. The format:
${CORPUS_FORMAT_DOC}
`

/** Print problems in a form somebody can act on, newest file first. */
function reportProblems(problems: CorpusProblem[], limit = 25): void {
  const byFile = new Map<string, CorpusProblem[]>()
  for (const problem of problems) {
    const found = byFile.get(problem.file)
    if (found) found.push(problem)
    else byFile.set(problem.file, [problem])
  }
  for (const [file, rows] of byFile) {
    out(`  ${file}  (${rows.length} problem${rows.length === 1 ? "" : "s"})`)
    for (const row of rows.slice(0, limit)) {
      const where = row.id ? ` [${row.id}]` : row.index === null ? "" : ` [item ${row.index}]`
      out(`    ${where} ${row.message}`)
    }
    if (rows.length > limit) out(`    ... and ${rows.length - limit} more`)
  }
}

/**
 * The closest key to a misspelled one, or null.
 *
 * A typo in a field name is the likely cause, so naming the key the writer
 * probably meant turns a report into a fix. Two edits is the useful bound:
 * further than that and the suggestion misleads more than it helps.
 */
function nearestKey(field: string, present: Set<string>): string | null {
  let best: string | null = null
  let bestDistance = 3
  for (const candidate of present) {
    const distance = editDistance(field, candidate)
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

/** Levenshtein distance, one row at a time. The strings here are field names. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const substitute = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1)
      current[j] = Math.min(substitute, (previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1)
    }
    previous = current
  }
  return previous[b.length] ?? Math.max(a.length, b.length)
}

/**
 * Every field a profile names must exist on a card.
 *
 * `cards.textFields` and `cards.statFields` are references into the data, and
 * nothing else checks them. A misspelled name costs the whole benefit twice
 * over: the assistant is told about a field no card carries, and it is never
 * told about the field that exists. Both failures are silent, and a reader sees
 * only a slightly worse answer.
 *
 * A profile is optional, and a corpus with none is valid.
 */
export function checkProfileFields(dir: string, corpus: Corpus): Problem[] {
  let profile: Profile
  try {
    profile = parseProfile(JSON.parse(readFileSync(resolve(dir, "profile.json"), "utf8")))
  } catch {
    return []
  }
  if (!profile.cards.enabled) return []

  const textKeys = new Set(corpus.cards.flatMap((c) => Object.keys(c.text)))
  const statKeys = new Set(corpus.cards.flatMap((c) => Object.keys(c.stats)))
  const problems: Problem[] = []

  const check = (declared: { field: string }[], present: Set<string>, name: string) => {
    declared.forEach(({ field }, index) => {
      if (present.has(field)) return
      const near = nearestKey(field, present)
      problems.push({
        file: "profile.json",
        index,
        message: `cards.${name} names "${field}", which no card carries${near ? `. Did you mean "${near}"?` : ""}`,
      })
    })
  }
  check(profile.cards.textFields, textKeys, "textFields")
  check(profile.cards.statFields, statKeys, "statFields")
  return problems
}

/**
 * True when a corpus states terms for a developer and none for a reader.
 *
 * `NOTICE.txt` is the developer's file: it says what you may build and sell.
 * The person asking whether a unit can block needs one sentence saying who owns
 * these rules, and `profile.attribution` is where a corpus author writes it.
 *
 * This is a note and never a failure. A corpus in the public domain carries no
 * notice, and one may still choose to say nothing to a reader.
 */
export function missingReaderCredit(dir: string): boolean {
  if (!existsSync(join(dir, "NOTICE.txt"))) return false
  try {
    return !parseProfile(JSON.parse(readFileSync(resolve(dir, "profile.json"), "utf8"))).attribution
  } catch {
    // No profile, or one this version cannot read. Other checks report that.
    return false
  }
}

/**
 * Report any JSON file the corpus format does not know.
 *
 * One collection may be absent, which means a misspelled file name no longer
 * stops the load: `rulings.jsonn` reads as "this game has no rulings", and the
 * writer sees a corpus that validates and answers nothing. Naming the stray file
 * costs one directory read and turns that silence back into a message.
 *
 * It suggests the nearest known name, because the cause is nearly always a typo.
 */
export async function checkStrayFiles(dir: string): Promise<Problem[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }
  const known = new Set(KNOWN_CORPUS_FILES)
  const problems: Problem[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".json") || known.has(entry)) continue
    const near = nearestKey(entry, known)
    problems.push({
      file: entry,
      index: null,
      message: `is not part of the corpus format, so nothing reads it${near ? `. Did you mean "${near}"?` : ""}`,
    })
  }
  return problems
}

async function commandValidate(dir: string): Promise<number> {
  out(`Validating ${dir}`)
  const result = await loadCorpus(dir)
  if (!result.ok) {
    err("\nThe corpus could not be read:")
    reportProblems(result.problems)
    return 1
  }
  const { corpus, problems } = result
  const integrity = checkIntegrity(corpus)

  out("")
  out(`  game        ${corpus.game.name} (${corpus.game.slug})`)
  out(`  rulebooks   ${corpus.rulebooks.length}`)
  out(`  sections    ${corpus.sections.length}`)
  out(`  rules       ${corpus.rules.length}`)
  out(`  terms       ${corpus.terms.length}`)
  out(`  errata      ${corpus.errata.length}`)
  out(`  banlist     ${corpus.banlist.length}`)
  out(`  patch notes ${corpus.patchNotes.length}`)
  out(`  cards       ${corpus.cards.length}`)
  out(
    `  rulings     ${corpus.rulings.length}${existsSync(join(dir, "rulings.json")) ? "" : " (no rulings.json)"}`,
  )
  out("")

  if (problems.length) {
    out(`${problems.length} row${problems.length === 1 ? "" : "s"} failed validation and would be dropped:`)
    reportProblems(problems)
    out("")
  }
  if (integrity.length) {
    out(
      `${integrity.length} link${integrity.length === 1 ? " points" : "s point"} at something that does not exist:`,
    )
    reportProblems(integrity)
    out("")
  }

  const profileProblems = checkProfileFields(dir, corpus)
  if (profileProblems.length) {
    out(`${profileProblems.length} field${profileProblems.length === 1 ? "" : "s"} in profile.json:`)
    reportProblems(profileProblems)
    out("")
  }

  const strays = await checkStrayFiles(dir)
  if (strays.length) {
    out(`${strays.length} file${strays.length === 1 ? "" : "s"} nothing reads:`)
    reportProblems(strays)
    out("")
  }

  if (missingReaderCredit(dir)) {
    out("Note: this corpus carries NOTICE.txt, and its profile sets no `attribution`.")
    out("      NOTICE.txt is written for a developer choosing a corpus. It names")
    out("      licences and directories, which the person asking a rules question")
    out("      has no use for. Set `attribution` in profile.json to give every")
    out("      application one sentence to show that person under an answer.")
    out("")
  }

  // A corpus with no rules parses fine and answers nothing, which is the one
  // failure a reader will not notice until the assistant is already deployed.
  if (!corpus.rules.length) {
    err("This corpus holds no rules. Nothing will be able to answer a rules question.")
    return 1
  }

  if (problems.length || integrity.length || profileProblems.length || strays.length) {
    err("Validation failed.")
    return 1
  }
  out("Valid.")
  return 0
}

async function commandBuild(dir: string, outFile: string | null): Promise<number> {
  const target = outFile ?? join(dir, "corpus.db")
  out(`Building ${dir}`)
  const result = await loadCorpus(dir)
  if (!result.ok) {
    err("The corpus could not be read. Run `rulekit validate` to see why.")
    return 1
  }
  if (result.problems.length) {
    err(
      `${result.problems.length} rows failed validation and were dropped. Run \`rulekit validate\` to see them.`,
    )
  }
  const startedAt = Date.now()
  const db = buildDatabase(result.corpus, { path: target })
  db.close()
  const size = (await stat(target)).size
  out(`Wrote ${target} (${(size / 1024 / 1024).toFixed(1)} MB) in ${Date.now() - startedAt} ms`)
  return 0
}

async function commandInit(dir: string, corpus = "demo"): Promise<number> {
  const source = CORPUS_ROOTS.map((root) => join(root, corpus)).find((path) => existsSync(path))
  if (!source) {
    // Name what this installation actually holds. The four that ship are the
    // whole answer for anybody who installed from npm; Riftbound lives only in
    // the repository, because Riot Games owns that data.
    err(`No corpus called "${corpus}" is installed.`)
    err(`This package ships: ${SHIPPED_CORPORA.join(", ")}.`)
    err("The Riftbound corpus is in the repository only, at data/riftbound:")
    err("  https://github.com/rulekitai/rulekit/tree/main/data/riftbound")
    return 1
  }
  await mkdir(dir, { recursive: true })
  // corpus.db is a build artefact. Copying one compiled from another directory
  // would answer questions from rules that the JSON beside it no longer states.
  await cp(source, dir, { recursive: true, filter: (from) => !from.endsWith("corpus.db") })
  out(`Copied the ${corpus} corpus to ${dir}`)
  out("")
  out("Next:")
  out(`  1. Edit the JSON files in ${dir}. The format: ${CORPUS_FORMAT_DOC}`)
  out(`  2. rulekit validate ${dir}`)
  out(`  3. rulekit build ${dir}`)
  return 0
}

/**
 * Ask a question using only the stages that need no model.
 *
 * This is how you check a corpus without spending anything. A question the free
 * stages cannot answer reports that plainly, which is the honest result rather
 * than a failure.
 */
async function commandAsk(dir: string, question: string, asJson = false): Promise<number> {
  const result = await loadCorpus(dir)
  if (!result.ok) {
    err("The corpus could not be read. Run `rulekit validate` to see why.")
    return 1
  }
  const store = SqliteStore.fromCorpus(result.corpus)

  const { createPipeline } = await import("../pipeline/pipeline.ts")
  const { staticAnswersStage } = await import("../pipeline/stages/static.ts")
  const { glossaryStage } = await import("../pipeline/stages/glossary.ts")
  const { minimalProfile, parseProfile } = await import("../agent/profile.ts")

  // The profile is optional here: a corpus can be checked before anybody writes
  // one, and the free stages read almost nothing from it.
  let profile = minimalProfile(result.corpus.game.name, result.corpus.game.slug)
  try {
    profile = parseProfile(JSON.parse(await readFile(join(dir, "profile.json"), "utf8")))
  } catch {
    // A note for a person reading the output. It is left out of the JSON, which
    // a script parses as one object and would choke on.
    if (!asJson) out("(no profile.json — using defaults)\n")
  }

  const pipeline = createPipeline({
    store,
    profile,
    stages: [staticAnswersStage(store), glossaryStage(store)],
  })
  const answered = await pipeline.run({ question })
  await store.close()

  const trace = answered.trace.map((step) => ({ stage: step.stage, outcome: step.outcome }))

  if (!answered.answer) {
    // A miss has two causes that read alike from outside, so name which one it
    // was. A question the classifier never matched and a rule number the corpus
    // does not hold both leave every stage passed, and somebody who cannot tell
    // them apart retries the same wrong shape.
    const { classify } = await import("../pipeline/stages/static-classify.ts")
    const asked = classify(question)
    const missingRule = asked.intent === "RULE_N" ? asked.ruleNumber : null

    if (asJson) {
      out(JSON.stringify({ question, answered: false, missingRule, trace }))
      return 0
    }

    if (missingRule) out(`This corpus holds no rule ${missingRule}.`)
    else {
      // Name the variable. "The agent needs a model key" is true and leaves a
      // reader standing exactly where they cannot act: they know they need a
      // credential and not which name this package reads.
      out("No free stage could answer this. It would go to the agent, and the agent needs a model")
      out(`credential. A server reads ${DEFAULT_CREDENTIAL_VARIABLE} from its environment by default.`)
      out("This command never calls the agent, whatever you set.")
    }
    out(`Stages tried: ${trace.map((t) => `${t.stage}=${t.outcome}`).join(", ")}`)

    // Name the SHAPE beside the example. A reader whose question missed cannot
    // tell which part of an example was load-bearing, and a message that names
    // fewer shapes than the corpus answers reads as a complete list: one that
    // omitted rulings sent a reader away from the feature they had just added.
    const where = relative(cwd(), dir) || dir
    const rule = result.corpus.rules.find((r) => r.rule_type !== "section_header" && r.content.trim() !== "")
    const term = result.corpus.terms[0]
    const banned = result.corpus.banlist.find((b) => b.card?.name)?.card?.name
    const ruled = result.corpus.rulings.flatMap((r) => r.cards).find((c) => c.name)?.name
    const published = result.corpus.rulings.find((r) => r.question.trim())?.question.trim()

    const shapes: [string, string][] = []
    if (rule) shapes.push(["a rule number", `what does rule ${rule.rule_number} say`])
    if (banned) shapes.push(["a legality question", `is ${banned} banned`])
    if (ruled) shapes.push(["a rulings lookup", `rulings for ${ruled}`])
    if (published) shapes.push(["a ruling's own question", published])
    if (term) shapes.push(["a keyword", `what is ${term.term}`])

    const count = ["no", "one", "two", "three", "four", "five"][shapes.length] ?? String(shapes.length)
    out(`\nThe free stages answer ${count} shape${shapes.length === 1 ? "" : "s"} of question here:`)
    for (const [shape, example] of shapes) out(`  ${shape.padEnd(24)} rulekit ask ${where} "${example}"`)
    out(`\nThe agent answers every other question. The README section "${AGENT_README_SECTION}" starts one:`)
    out(`  ${AGENT_README_URL}`)
    return 0
  }

  if (asJson) {
    // `usage` holds what the answer cost, which no free stage spends. Every
    // other field is printed as the pipeline produced it.
    const { usage: _usage, ...answer } = answered.answer
    out(JSON.stringify({ question, answered: true, ...answer, trace }))
    return 0
  }
  out(`[served by ${answered.answer.servedBy} in ${answered.answer.latencyMs} ms]\n`)
  out(answered.answer.text)
  return 0
}

function flag(name: string): string | null {
  const index = argv.indexOf(`--${name}`)
  return index === -1 ? null : (argv[index + 1] ?? null)
}

async function main(): Promise<number> {
  const [command, ...rest] = argv.slice(2)
  // A flag's VALUE is not a positional argument. Listing the value-taking flags
  // is what stops `--model anthropic/x` leaving "anthropic/x" to be read as the
  // corpus directory.
  const VALUE_FLAGS = new Set(["--out", "--model", "--only", "--step-cap", "--regrade", "--corpus"])
  const positional = rest.filter(
    (arg, index) => !arg.startsWith("--") && !VALUE_FLAGS.has(rest[index - 1] ?? ""),
  )

  switch (command) {
    case "validate": {
      if (!positional[0]) {
        err("Usage: rulekit validate <dir>")
        return 2
      }
      return commandValidate(resolve(positional[0]))
    }
    case "build": {
      if (!positional[0]) {
        err("Usage: rulekit build <dir> [--out file]")
        return 2
      }
      const outFile = flag("out")
      return commandBuild(resolve(positional[0]), outFile ? resolve(outFile) : null)
    }
    case "init": {
      if (!positional[0]) {
        err(`Usage: rulekit init <dir> [--corpus ${SHIPPED_CORPORA.join("|")}]`)
        return 2
      }
      return commandInit(resolve(positional[0]), flag("corpus") ?? "demo")
    }
    case "ask": {
      if (!positional[0] || !positional[1]) {
        err('Usage: rulekit ask <dir> "<question>" [--json]')
        return 2
      }
      return commandAsk(resolve(positional[0]), positional.slice(1).join(" "), argv.includes("--json"))
    }
    case "eval": {
      if (!positional[0]) {
        err("Usage: rulekit eval <dir> [--model id] [--out file] [--only text] [--step-cap n]")
        return 2
      }
      const { commandEval } = await import("./eval.ts")
      const cap = flag("step-cap")
      return commandEval({
        corpusDir: resolve(positional[0]),
        model: flag("model") ?? "anthropic/claude-sonnet-5",
        outFile: flag("out") ? resolve(flag("out") as string) : null,
        filter: flag("only"),
        stepCap: cap ? Number(cap) : null,
        regradeFile: flag("regrade") ? resolve(flag("regrade") as string) : null,
      })
    }
    case "--version":
    case "-v":
      // The bare version and nothing else, so a script can read it whole.
      out(packageVersion())
      return 0
    case "--help":
    case "-h":
    case "help":
    case undefined:
      out(USAGE)
      return 0
    default:
      err(`Unknown command: ${command}\n`)
      err(USAGE)
      return 2
  }
}

/**
 * Is this file the command that was run, rather than a module somebody imported?
 *
 * Without this check, importing a command to test it runs the whole program and
 * calls `exit`, which kills the test runner before a single assertion.
 *
 * RESOLVE THE SYMLINK BEFORE COMPARING. npm installs a `bin` as a symlink in
 * `node_modules/.bin`, so `process.argv[1]` is the link and `import.meta.url`
 * is its target. An unresolved comparison therefore fails for every user who
 * installs from npm, and the command exits 0 and prints nothing. It works when
 * run from a path inside the repository, so no test here saw it.
 */
export function isMainModule(argv1: string | undefined, metaUrl: string): boolean {
  if (!argv1) return false
  let target = argv1
  try {
    target = realpathSync(argv1)
  } catch {
    // A path that cannot be resolved is compared as it arrived.
  }
  return metaUrl === pathToFileURL(target).href
}

if (isMainModule(process.argv[1], import.meta.url)) {
  main()
    .then((code) => exit(code))
    .catch((error) => {
      err(`\nrulekit failed: ${error?.message ?? String(error)}`)
      exit(1)
    })
}

export {
  commandAsk,
  commandBuild,
  commandInit,
  commandValidate,
  main,
  packageVersion,
  reportProblems,
  SHIPPED_CORPORA,
}
