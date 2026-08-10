#!/usr/bin/env node
import { readFileSync } from "node:fs"
import { cp, mkdir, readFile, stat } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import { argv, cwd, exit, stderr, stdout } from "node:process"
import { fileURLToPath, pathToFileURL } from "node:url"
import { type Profile, parseProfile } from "@rulekit/agent/profile"
import { buildDatabase } from "@rulekit/corpus/build"
import { type CorpusProblem, checkIntegrity, loadCorpus } from "@rulekit/corpus/load"
import { SqliteStore } from "@rulekit/corpus/sqlite-store"
import type { Corpus } from "@rulekit/corpus/types"

/**
 * The `rulekit` command.
 *
 * Four things, and no more. There is no `import` and no `fetch`: this project
 * does no data collection, so a corpus arrives already written and the command
 * only ever reads, checks, and compiles one.
 */

type Problem = CorpusProblem

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, "../../..")

const out = (line = "") => stdout.write(`${line}\n`)
const err = (line: string) => stderr.write(`${line}\n`)

const USAGE = `rulekit — a grounded rules assistant over your own corpus

Usage:
  rulekit validate <dir>          Check a corpus and name every problem
  rulekit build <dir> [--out f]   Compile a corpus to a SQLite database
  rulekit init <dir>              Copy the example corpus as a starting point
  rulekit ask <dir> "<question>"  Ask a rule-number or keyword question, with no
                                  model. This runs the free stages only, so it
                                  never reaches the agent. Use it to check a
                                  corpus, not to ask the whole range of
                                  questions a served assistant answers.
  rulekit eval <dir> [options]    Run the corpus's eval.json through the agent
                                  and check nothing was invented. Needs a model
                                  credential. Exits non-zero on any fabrication.

eval options:
  --model <id>     Model to grade. Default anthropic/claude-sonnet-5.
  --out <file>     Write full results as JSON.
  --only <text>    Run only questions whose id or category contains this.
  --step-cap <n>   Cap model calls per question. Default none, as in production.
  --regrade <file> Grade a previous run's answers again, with no model calls.

Every corpus is a directory of JSON files. See docs/corpus-format.md.
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
      const where = row.index === null ? "" : ` [item ${row.index}]`
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
  out("")

  if (problems.length) {
    out(`${problems.length} row${problems.length === 1 ? "" : "s"} failed validation and would be dropped:`)
    reportProblems(problems)
    out("")
  }
  if (integrity.length) {
    out(
      `${integrity.length} link${integrity.length === 1 ? "" : "s"} point at something that does not exist:`,
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

  // A corpus with no rules parses fine and answers nothing, which is the one
  // failure a reader will not notice until the assistant is already deployed.
  if (!corpus.rules.length) {
    err("This corpus holds no rules. Nothing will be able to answer a rules question.")
    return 1
  }

  if (problems.length || integrity.length || profileProblems.length) {
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

async function commandInit(dir: string): Promise<number> {
  const source = join(REPO_ROOT, "data", "demo")
  await mkdir(dir, { recursive: true })
  await cp(source, dir, { recursive: true })
  out(`Copied the example corpus to ${dir}`)
  out("")
  out("Next:")
  out(`  1. Edit the JSON files in ${dir}. See docs/corpus-format.md.`)
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
async function commandAsk(dir: string, question: string): Promise<number> {
  const result = await loadCorpus(dir)
  if (!result.ok) {
    err("The corpus could not be read. Run `rulekit validate` to see why.")
    return 1
  }
  const store = SqliteStore.fromCorpus(result.corpus)

  const { createPipeline } = await import("@rulekit/pipeline/pipeline")
  const { staticAnswersStage } = await import("@rulekit/pipeline/stages/static")
  const { glossaryStage } = await import("@rulekit/pipeline/stages/glossary")
  const { minimalProfile, parseProfile } = await import("@rulekit/agent/profile")

  // The profile is optional here: a corpus can be checked before anybody writes
  // one, and the free stages read almost nothing from it.
  let profile = minimalProfile(result.corpus.game.name, result.corpus.game.slug)
  try {
    profile = parseProfile(JSON.parse(await readFile(join(dir, "profile.json"), "utf8")))
  } catch {
    out("(no profile.json — using defaults)\n")
  }

  const pipeline = createPipeline({
    store,
    profile,
    stages: [staticAnswersStage(store), glossaryStage(store)],
  })
  const answered = await pipeline.run({ question })
  await store.close()

  if (!answered.answer) {
    // A miss has two causes that read alike from outside, so name which one it
    // was. A question the classifier never matched and a rule number the corpus
    // does not hold both leave every stage passed, and somebody who cannot tell
    // them apart retries the same wrong shape.
    const { classify } = await import("@rulekit/pipeline/stages/static-classify")
    const asked = classify(question)
    const missingRule = asked.intent === "RULE_N" ? asked.ruleNumber : null

    if (missingRule) out(`This corpus holds no rule ${missingRule}.`)
    else out(`No free stage could answer this. It would go to the agent, and the agent needs a model key.`)
    out(`Stages tried: ${answered.trace.map((t) => `${t.stage}=${t.outcome}`).join(", ")}`)

    const where = relative(cwd(), dir) || dir
    const rule = result.corpus.rules.find((r) => r.rule_type !== "section_header" && r.content.trim() !== "")
    const term = result.corpus.terms[0]
    out(`\nThe free stages answer two shapes of question:`)
    if (rule) out(`  rulekit ask ${where} "what does rule ${rule.rule_number} say"`)
    if (term) out(`  rulekit ask ${where} "what is ${term.term}"`)
    out(`\nThe agent answers every other question. README.md, "Run it", starts one.`)
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
  const VALUE_FLAGS = new Set(["--out", "--model", "--only", "--step-cap", "--regrade"])
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
        err("Usage: rulekit init <dir>")
        return 2
      }
      return commandInit(resolve(positional[0]))
    }
    case "ask": {
      if (!positional[0] || !positional[1]) {
        err('Usage: rulekit ask <dir> "<question>"')
        return 2
      }
      return commandAsk(resolve(positional[0]), positional.slice(1).join(" "))
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
 * Run only when this file IS the command, never when it is imported.
 *
 * Without the guard, importing a command to test it runs the whole program and
 * calls `exit`, which kills the test runner before a single assertion.
 */
const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false

if (isDirectRun) {
  main()
    .then((code) => exit(code))
    .catch((error) => {
      err(`\nrulekit failed: ${error?.message ?? String(error)}`)
      exit(1)
    })
}

export { commandAsk, commandBuild, commandInit, commandValidate, main, reportProblems }
