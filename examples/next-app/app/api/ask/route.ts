import { createAskHandler } from "@rulekit/server/handler"
import { rulekit } from "../../lib/rulekit.ts"

/**
 * The whole backend, in six lines.
 *
 * `createAskHandler` takes a web-standard Request and returns a web-standard
 * Response, so this file has nothing to translate. The same handler mounts in
 * Hono, Bun, Deno, or a Cloudflare Worker without a change.
 *
 * There is no gate here, so this example allows every question from everybody.
 * That is the right default for something you run yourself and the wrong one
 * for something you put on the internet. Pass a `gate` to add quotas or billing;
 * nothing inside the packages needs to change.
 */

const { pipeline, agent } = rulekit()

export const POST = createAskHandler({ pipeline, agent })

/** A tool-calling turn can take a while. Give it room before the platform cuts it. */
export const maxDuration = 300

/** The corpus is a file on disk, so this must run where a filesystem exists. */
export const runtime = "nodejs"
