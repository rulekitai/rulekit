/**
 * Hide Node's SQLite notice, and print every other warning.
 *
 * The corpus store reads `node:sqlite`, which ships inside Node and is still
 * marked experimental. Node therefore prints this before anything else, on
 * every start of every program that opens a corpus:
 *
 *     ExperimentalWarning: SQLite is an experimental feature and might change
 *     at any time
 *
 * It names nothing a reader can act on, and it arrives ahead of the output they
 * asked for. `--no-warnings` silences it, and silences every other warning with
 * it, which is a bad trade for a server.
 *
 * THE LIBRARY NEVER CALLS THIS BY ITSELF. Which warnings a program prints is
 * the program's decision, and a library that made it would be taking something
 * that is not its own. The `rulekit` command calls it, because the command is a
 * program. A host application calls it in one line if it wants the same.
 *
 * Node prints a warning through a default listener, so removing the listeners
 * first is what stops the same warning appearing twice.
 */
export function hideSqliteExperimentalWarning(): void {
  process.removeAllListeners("warning")
  process.on("warning", (warning) => {
    const isSqliteNotice = warning.name === "ExperimentalWarning" && /SQLite/i.test(warning.message)
    if (isSqliteNotice) return
    process.stderr.write(`${warning.stack ?? `${warning.name}: ${warning.message}`}\n`)
  })
}
