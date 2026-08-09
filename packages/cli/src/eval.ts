import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { minimalProfile, parseProfile } from "@rulekit/agent/profile"
import { createRulesAgent } from "@rulekit/agent/runtime"
import { loadCorpus } from "@rulekit/corpus/load"
import { SqliteStore } from "@rulekit/corpus/sqlite-store"
import type { RuleStore } from "@rulekit/corpus/store"
import { z } from "zod"
import {
  buildHaystack,
  DEFAULT_RULE_PATTERN,
  type EvalQuestion,
  type Grade,
  gradeAnswer,
  summarise,
} from "./grade.ts"

/**
 * `rulekit eval` — does this thing lie?
 *
 * It runs every question in a corpus's evaluation set through the agent and
 * applies two gates that no model judges: every rule number cited must exist,
 * and every quoted passage must appear in the corpus. Either failure exits
 * non-zero.
 *
 * NOT A CONTINUOUS-INTEGRATION CHECK. It needs a model credential and takes
 * minutes. Run it before adopting a model, before changing the instructions, and
 * before shipping a corpus.
 *
 * The standing rule this exists to serve: adopt the cheapest model that
 * fabricates nothing, and never let a cost saving outweigh a non-zero
 * fabrication count.
 */

const questionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  category: z.string().default("uncategorised"),
  difficulty: z.string().default("unknown"),
  expected_rule_numbers: z.array(z.string()).default([]),
  rubric: z.string().default(""),
})

const fileSchema = z.object({
  schemaVersion: z.number().int(),
  items: z.array(questionSchema),
  /** Overrides what counts as a rule citation, for a game numbered differently. */
  rulePattern: z.string().optional(),
})

const out = (line = "") => process.stdout.write(`${line}\n`)
const err = (line: string) => process.stderr.write(`${line}\n`)

/** Pad a string to a width, for a readable table on a terminal. */
const pad = (text: string, width: number) => text.padEnd(width).slice(0, width)

export type EvalOptions = {
  corpusDir: string
  model: string
  outFile: string | null
  /** Run only questions whose id or category contains this. */
  filter: string | null
  /** A ceiling on model calls per question. Unset means none, as in production. */
  stepCap: number | null
  /**
   * Grade the answers in a previous result file instead of asking again.
   *
   * The grader changes far more often than the answers do, and re-running
   * eighteen questions to check a grading change costs minutes and real money.
   * Every result file carries its answers for exactly this.
   */
  regradeFile: string | null
}

export async function commandEval(options: EvalOptions): Promise<number> {
  const loaded = await loadCorpus(options.corpusDir)
  if (!loaded.ok) {
    err("The corpus could not be read. Run `rulekit validate` to see why.")
    return 1
  }

  let file: z.output<typeof fileSchema>
  try {
    const raw = JSON.parse(await readFile(join(options.corpusDir, "eval.json"), "utf8"))
    file = fileSchema.parse(raw)
  } catch (error) {
    err(`No usable eval.json in ${options.corpusDir}: ${String(error)}`)
    err("See docs/corpus-format.md for the shape.")
    return 2
  }

  const store: RuleStore = SqliteStore.fromCorpus(loaded.corpus)
  let profile = minimalProfile(loaded.corpus.game.name, loaded.corpus.game.slug)
  try {
    profile = parseProfile(JSON.parse(await readFile(join(options.corpusDir, "profile.json"), "utf8")))
  } catch {
    out("(no profile.json — using defaults)")
  }

  const questions = file.items.filter(
    (q) => !options.filter || q.id.includes(options.filter) || q.category.includes(options.filter),
  )
  if (!questions.length) {
    err(`No question matches "${options.filter}".`)
    return 2
  }

  const agent = createRulesAgent({ store, profile, model: options.model, stepCap: options.stepCap })

  out(`Evaluating ${questions.length} questions against ${loaded.corpus.game.name}`)
  out(
    options.regradeFile ? `Re-grading saved answers from ${options.regradeFile}` : `Model: ${options.model}`,
  )
  out("")

  // Built once. It is the whole corpus as one folded string, and rebuilding it
  // per question would cost more than the model calls do.
  const haystack = await buildHaystack(store)
  const pattern = file.rulePattern ?? DEFAULT_RULE_PATTERN

  const grades: Grade[] = []
  const answers: { id: string; question: string; answer: string; steps: number; ms: number }[] = []

  out(
    `${pad("id", 8)} ${pad("category", 13)} ${pad("cites", 6)} ${pad("recall", 8)} ${pad("steps", 6)} verdict`,
  )
  out("-".repeat(72))

  // Answers from a previous run, when this is a re-grade.
  const saved = new Map<string, { answer: string; steps: number }>()
  if (options.regradeFile) {
    const previous = JSON.parse(await readFile(options.regradeFile, "utf8")) as {
      answers?: { id: string; answer: string; steps: number }[]
    }
    for (const a of previous.answers ?? []) saved.set(a.id, { answer: a.answer, steps: a.steps })
    if (!saved.size) {
      err(`${options.regradeFile} carries no answers to re-grade.`)
      return 2
    }
  }

  for (const question of questions as EvalQuestion[]) {
    const startedAt = Date.now()
    let answer = ""
    let steps = 0
    let failure: string | null = null

    const previous = saved.get(question.id)
    if (options.regradeFile) {
      if (!previous) continue
      answer = previous.answer
      steps = previous.steps
    } else {
      try {
        const result = await agent.ask({ question: question.question })
        answer = result.text
        steps = result.usage?.agent_steps ?? 0
        // An answer of no characters is not an answer. It cites nothing and
        // quotes nothing, so both fabrication gates pass it, and a run that
        // died halfway through would report a perfect score.
        if (!answer.trim()) failure = "the agent returned an empty answer"
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
    }

    const ms = Date.now() - startedAt
    answers.push({ id: question.id, question: question.question, answer, steps, ms })

    if (failure) {
      // A turn that never produced an answer is not a clean pass. Recording it
      // as one would let an outage read as a perfect score.
      out(
        `${pad(question.id, 8)} ${pad(question.category, 13)} ${pad("-", 6)} ${pad("-", 8)} ${pad("-", 6)} ERROR ${failure.slice(0, 40)}`,
      )
      grades.push({
        id: question.id,
        category: question.category,
        difficulty: question.difficulty,
        fabricatedRules: [],
        fabricatedQuotes: [],
        recalled: [],
        missed: question.expected_rule_numbers,
        staleExpectations: [],
        citedCount: 0,
        quoteCount: 0,
        answerChars: 0,
        clean: false,
      })
      continue
    }

    const grade = await gradeAnswer(question, answer, store, haystack, pattern)
    grades.push(grade)

    const live = grade.recalled.length + grade.missed.length
    const recall = live ? `${grade.recalled.length}/${live}` : "n/a"
    const verdict = grade.clean
      ? "ok"
      : `FABRICATED ${[...grade.fabricatedRules, ...grade.fabricatedQuotes.map(() => "quote")].join(" ")}`
    out(
      `${pad(question.id, 8)} ${pad(question.category, 13)} ${pad(String(grade.citedCount), 6)} ${pad(recall, 8)} ${pad(String(steps), 6)} ${verdict}`,
    )
  }

  const summary = summarise(grades)
  out("")
  out(`clean answers        ${summary.clean} of ${summary.questions}`)
  out(`fabricated rules     ${summary.fabricatedRuleCount}`)
  out(`fabricated quotes    ${summary.fabricatedQuoteCount}`)
  out(`citation recall      ${(summary.recall * 100).toFixed(0)}%`)

  if (summary.staleExpectationCount > 0) {
    out("")
    out(
      `${summary.staleExpectationCount} expected rule numbers are not in this corpus. That is the ` +
        "evaluation set drifting from the rulebook, not the model failing. They are excluded from recall.",
    )
    for (const grade of grades.filter((g) => g.staleExpectations.length)) {
      out(`  ${grade.id}: ${grade.staleExpectations.join(", ")}`)
    }
  }

  if (options.outFile) {
    await writeFile(
      options.outFile,
      `${JSON.stringify({ model: options.model, corpus: loaded.corpus.game.slug, summary, grades, answers }, null, 2)}\n`,
      "utf8",
    )
    out(`\nWrote ${options.outFile}`)
  }

  await store.close()

  const failed = summary.fabricatedRuleCount + summary.fabricatedQuoteCount
  if (failed > 0) {
    out("")
    err(
      `FAILED: ${failed} fabrication${failed === 1 ? "" : "s"}. This model must not ship against this ` +
        "corpus. A cited rule that does not exist, or a quote the corpus does not hold, reads exactly " +
        "like a correct answer to somebody who cannot check.",
    )
    return 1
  }
  if (summary.clean < summary.questions) {
    err(`\nFAILED: ${summary.questions - summary.clean} questions did not produce an answer.`)
    return 1
  }

  out("\nNo fabrications. Every cited rule exists and every quoted passage is in the corpus.")
  return 0
}
