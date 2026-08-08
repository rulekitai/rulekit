"use client"

/**
 * Shown between the question and the first byte of an answer.
 *
 * A free stage answers in milliseconds and this never appears. A model takes
 * seconds, and a screen that does nothing for seconds reads as broken.
 */
export function ThinkingIndicator(props: { label?: string }) {
  return (
    <div className="rk-thinking" role="status" aria-live="polite">
      <span className="rk-thinking-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {props.label ?? "Reading the rules"}
    </div>
  )
}
