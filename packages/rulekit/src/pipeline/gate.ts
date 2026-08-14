import type { Answer, AskContext, CredentialResolver, Gate, GateVerdict } from "./types.ts"

/**
 * The gate that allows everything.
 *
 * **This is the only gate this project ships, and that is deliberate.** There is
 * no pricing model here, no quota, no rate limit, and no account. A fork adds
 * its own by implementing `Gate`, and never has to edit anything in these
 * packages to do it.
 *
 * If you are adding billing: `allow` runs before the pipeline, so a refusal
 * costs nothing at all. `record` runs after, with the answer and its usage,
 * which is where you count or charge.
 */
export const openGate: Gate = {
  async allow(): Promise<GateVerdict> {
    return { allow: true }
  },
  async record(): Promise<void> {},
}

/** Combine gates. The first refusal wins, and every gate still records. */
export function allGates(...gates: Gate[]): Gate {
  return {
    async allow(ctx: AskContext): Promise<GateVerdict> {
      for (const gate of gates) {
        const verdict = await gate.allow(ctx)
        if (!verdict.allow) return verdict
      }
      return { allow: true }
    },
    async record(ctx: AskContext, answer: Answer): Promise<void> {
      // Every gate records, even if one throws. A counter that stops counting
      // because a neighbour failed is a budget that silently stops working.
      await Promise.all(
        gates.map((gate) =>
          gate.record(ctx, answer).catch((err) => console.error("[rulekit] gate record failed:", err)),
        ),
      )
    },
  }
}

/**
 * The variable `fromEnv` reads when a caller names none.
 *
 * Exported so that a message telling somebody to set a credential can name the
 * one this package actually reads. The `rulekit ask` miss message said only
 * "the agent needs a model key", which is the moment a reader most needs the
 * name, and a second copy of the string would drift from this one.
 */
export const DEFAULT_CREDENTIAL_VARIABLE = "AI_GATEWAY_API_KEY"

/**
 * A credential from the process environment.
 *
 * The ordinary way to run this: one key, set once, used for everybody. The
 * variable name is yours; nothing here requires a particular provider.
 */
export function fromEnv(variable = DEFAULT_CREDENTIAL_VARIABLE): CredentialResolver {
  return {
    async resolve(): Promise<string | null> {
      return process.env[variable]?.trim() || null
    },
  }
}

/**
 * A credential the caller supplied on the request.
 *
 * This is the bring-your-own-key path: each reader pays their own provider with
 * their own key, and the host holds nothing. The key travels on every request
 * and is never stored here.
 *
 * Serve this over HTTPS only. A key in a header is a bearer credential, and a
 * plain-text hop hands it to anybody on the path.
 */
export function fromHeader(header = "x-model-key"): CredentialResolver {
  return {
    async resolve(request: Request | null): Promise<string | null> {
      return request?.headers.get(header)?.trim() || null
    },
  }
}

/** Try each resolver in order and take the first credential offered. */
export function firstOf(...resolvers: CredentialResolver[]): CredentialResolver {
  return {
    async resolve(request: Request | null, ctx?: AskContext): Promise<string | null> {
      for (const resolver of resolvers) {
        const key = await resolver.resolve(request, ctx)
        if (key) return key
      }
      return null
    },
  }
}
