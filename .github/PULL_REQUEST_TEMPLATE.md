## What this changes

<!-- State the problem first, and then the change. One or two sentences. -->

## Why

<!-- What went wrong, or what was missing. A reader of the log wants the reason. -->

## Checks

<!-- The continuous integration workflow runs the same four commands. -->

- [ ] `pnpm lint`
- [ ] `pnpm check-types`
- [ ] `pnpm test`
- [ ] `pnpm rulekit validate data/demo`

## If this changes a corpus

- [ ] `pnpm rulekit validate <dir>` prints `Valid.`
- [ ] `pnpm rulekit build <dir>` writes the database again
- [ ] The corpus directory holds a `LICENSE` file and a `NOTICE.txt` file

## Tests

<!-- Name the test you added, and state what it prevents. Write "none, and
     why" if this change needs no test. -->
