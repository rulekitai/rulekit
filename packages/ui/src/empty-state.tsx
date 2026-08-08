"use client"

import { useRuleKit } from "./provider.tsx"

/**
 * The first screen.
 *
 * The suggestions are the whole job. A reader who does not know what this can
 * answer will type something it declines, read the refusal as a failure, and
 * leave. Four real questions teach the scope faster than any paragraph.
 */
export function EmptyState(props: { title?: string; subtitle?: string; onPick: (question: string) => void }) {
  const { suggestions } = useRuleKit()
  return (
    <div className="rk-empty">
      <h2 className="rk-empty-title">{props.title ?? "Ask a rules question"}</h2>
      {props.subtitle ? <p className="rk-empty-subtitle">{props.subtitle}</p> : null}
      {suggestions?.length ? (
        <ul className="rk-suggestions">
          {suggestions.map((question) => (
            <li key={question}>
              <button type="button" className="rk-suggestion" onClick={() => props.onPick(question)}>
                {question}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
