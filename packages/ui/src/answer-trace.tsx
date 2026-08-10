"use client"

import type { TraceStep } from "@rulekitai/rulekit/agent/events"
import { useMemo, useState } from "react"

/**
 * What the assistant did while a reader waited.
 *
 * The point is not decoration. An answer that says "I searched the rules and
 * read three of them" is one a reader can judge; an answer that appears from
 * nowhere is one they have to take on faith. This is the only part of the
 * interface that shows the grounding actually happened.
 *
 * Steps are grouped by kind, so eight lookups read as "Looked up 8 things"
 * rather than eight near-identical lines.
 */

const KIND_LABEL: Record<TraceStep["kind"], string> = {
  searched: "Searched",
  "looked-up": "Looked up",
  read: "Read",
  ran: "Ran",
}

const PLURAL: Record<TraceStep["kind"], string> = {
  searched: "searches",
  "looked-up": "lookups",
  read: "reads",
  ran: "steps",
}

export function AnswerTrace(props: { steps: TraceStep[]; running?: boolean }) {
  const [open, setOpen] = useState(false)
  const steps = props.steps ?? []

  const summary = useMemo(() => {
    const counts = new Map<TraceStep["kind"], number>()
    for (const step of steps) counts.set(step.kind, (counts.get(step.kind) ?? 0) + 1)
    return [...counts.entries()].map(([kind, count]) =>
      count === 1 ? `${KIND_LABEL[kind]} 1 thing` : `${KIND_LABEL[kind]} ${count} ${PLURAL[kind]}`,
    )
  }, [steps])

  if (!steps.length) return null
  const failed = steps.filter((step) => step.status === "failed" || step.status === "rejected").length

  return (
    <div className="rk-trace" data-running={props.running ? "true" : undefined}>
      <button
        type="button"
        className="rk-trace-summary"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="rk-trace-caret" aria-hidden="true">
          {open ? "▾" : "▸"}
        </span>
        {summary.join(", ")}
        {/* A failed lookup is named rather than hidden. An answer built on
            fewer sources than it tried for is one a reader should weigh. */}
        {failed > 0 ? <span className="rk-trace-failed"> · {failed} failed</span> : null}
      </button>
      {open ? (
        <ol className="rk-trace-steps">
          {steps.map((step) => (
            <li key={step.id} data-status={step.status}>
              <span className="rk-trace-dot" aria-hidden="true" />
              {step.label}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
