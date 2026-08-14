"use client"

import { AnswerMarkdown } from "./answer-markdown.tsx"
import { AnswerTrace } from "./answer-trace.tsx"
import { type ChatMessage, readSources } from "./message.ts"
import { useRuleKit } from "./provider.tsx"

/** How a stage is named to a reader. An internal name means nothing to them. */
const SERVED_BY_LABEL: Record<string, string> = {
  cache: "from a saved answer",
  static: "read from the rules data",
  glossary: "read from the glossary",
  semantic: "from a saved answer",
  cheap: "answered by a model",
  agent: "answered by a model",
}

function Meta(props: { message: ChatMessage }) {
  const { servedBy, latencyMs, model } = props.message
  if (!servedBy) return null
  const label = SERVED_BY_LABEL[servedBy] ?? servedBy
  const seconds = typeof latencyMs === "number" ? ` · ${(latencyMs / 1000).toFixed(1)}s` : ""
  return (
    <div className="rk-meta">
      {label}
      {seconds}
      {/* The model name is diagnostic and only meaningful once a model ran. */}
      {model && (servedBy === "agent" || servedBy === "cheap") ? ` · ${model}` : ""}
    </div>
  )
}

export function MessageRow(props: { message: ChatMessage; streaming?: boolean }) {
  const { message } = props
  const { disclaimer: configured } = useRuleKit()
  // A host app that passes a function gets to say something true of THIS
  // answer. Most answers cost no model call, and one fixed sentence about an AI
  // contradicts the trace line directly above it.
  const disclaimer =
    typeof configured === "function"
      ? configured(message.servedBy ?? "", readSources(message.steps), message.source)
      : configured

  if (message.role === "user") {
    return (
      <div className="rk-row rk-row-user">
        <div className="rk-bubble rk-bubble-user">{message.text}</div>
      </div>
    )
  }

  return (
    <div className="rk-row rk-row-assistant" data-error={message.error ? "true" : undefined}>
      {message.steps?.length ? <AnswerTrace steps={message.steps} running={props.streaming} /> : null}
      {message.error ? (
        <div className="rk-error">{message.text}</div>
      ) : (
        <>
          <AnswerMarkdown>{message.text}</AnswerMarkdown>
          <Meta message={message} />
          {/* Shown on a real answer only. A failure notice does not need a
              reminder that a model wrote it, because none did. */}
          {disclaimer && message.text ? <div className="rk-disclaimer">{disclaimer}</div> : null}
        </>
      )}
    </div>
  )
}
