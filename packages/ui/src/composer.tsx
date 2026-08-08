"use client"

import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"

/**
 * The input box.
 *
 * It owns its own text. That is deliberate: the conversation above can be long,
 * and a parent holding the draft re-renders every message in it on every
 * keystroke. Keeping the draft here means typing costs one small component.
 */

export type ComposerProps = {
  onSubmit: (question: string) => void
  disabled?: boolean
  placeholder?: string
  /** Refuse a longer question, matching the server's own cap. */
  maxLength?: number
  autoFocus?: boolean
}

export function Composer(props: ComposerProps) {
  const [value, setValue] = useState("")
  const textarea = useRef<HTMLTextAreaElement>(null)
  const maxLength = props.maxLength ?? 2000

  // Grow with the text, up to a point. Past that it scrolls, so a pasted wall
  // of text cannot push the conversation off the screen.
  useEffect(() => {
    const node = textarea.current
    if (!node) return
    node.style.height = "auto"
    node.style.height = `${Math.min(node.scrollHeight, 200)}px`
  }, [])

  const submit = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault()
      const question = value.trim()
      if (!question || props.disabled) return
      setValue("")
      const node = textarea.current
      if (node) node.style.height = "auto"
      props.onSubmit(question)
    },
    [value, props.disabled, props.onSubmit],
  )

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends, Shift and Enter makes a new line. Anything else would
      // surprise somebody, because every chat works this way.
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault()
        submit()
      }
    },
    [submit],
  )

  const remaining = maxLength - value.length

  return (
    <form className="rk-composer" onSubmit={submit}>
      <textarea
        ref={textarea}
        className="rk-composer-input"
        value={value}
        rows={1}
        maxLength={maxLength}
        disabled={props.disabled}
        // biome-ignore lint/a11y/noAutofocus: a chat's only control, on a screen a reader opened to type into
        autoFocus={props.autoFocus}
        placeholder={props.placeholder ?? "Ask a rules question"}
        aria-label="Ask a rules question"
        onChange={(event) => {
          setValue(event.target.value)
          const node = event.target
          node.style.height = "auto"
          node.style.height = `${Math.min(node.scrollHeight, 200)}px`
        }}
        onKeyDown={onKeyDown}
      />
      <div className="rk-composer-actions">
        {/* Only shown once it is close enough to matter. A counter on an empty
            box is noise. */}
        {remaining < 200 ? <span className="rk-composer-count">{remaining}</span> : null}
        <button type="submit" className="rk-composer-send" disabled={props.disabled || !value.trim()}>
          Ask
        </button>
      </div>
    </form>
  )
}
