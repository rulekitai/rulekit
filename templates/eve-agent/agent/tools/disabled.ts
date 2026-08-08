import { disableTool } from "eve/tools"

/**
 * Every built-in tool this agent must not have.
 *
 * An Eve agent starts able to read files, run shell commands, and fetch web
 * pages. A rules assistant needs none of them, and each one is a path by which a
 * question could reach something other than the corpus. A question is untrusted
 * input, so the smaller that surface is, the better.
 *
 * Switching off the shell also stops Eve starting a container for it, which is
 * why an agent that never intended to run a command still needs this line.
 */

export default {
  /** The agent must look an answer up, not ask the reader to supply it. */
  ask_question: disableTool(),

  /** No shell. This also keeps Eve from starting a sandbox container. */
  bash: disableTool(),

  /** No filesystem. The corpus is reached through its own tools. */
  glob: disableTool(),
  grep: disableTool(),
  read_file: disableTool(),

  /** Read-only. An assistant that can write is one that can be talked into it. */
  write_file: disableTool(),

  /** A single-question lookup needs no plan. */
  todo: disableTool(),

  /**
   * No web access.
   *
   * This is the important pair. Every claim must be traceable to the corpus, and
   * a model that can read the open web will ground an answer in a page nobody
   * chose, cite it as though it were the rules, and be wrong in a way that looks
   * exactly like being right.
   */
  web_fetch: disableTool(),
  web_search: disableTool(),
}
