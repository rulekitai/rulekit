import { SKILLS } from "./prose.ts"

/**
 * A skill is a page of instructions the model reads only when it needs them.
 *
 * The point is context, not capability. Everything in a skill could sit in the
 * system prompt, and then every question would pay for it. A skill applies to a
 * shape of question, so a rules question never carries the card procedure.
 *
 * The prose is authored as Markdown under `src/skills/` and compiled into a
 * module by `scripts/build-prose.mjs`. Nothing is read from disk at run time,
 * because a bundler cannot see a file a module opens by path and leaves it out.
 */
export type Skill = {
  name: string
  /** What the model reads to decide whether this applies. It must be specific. */
  description: string
  /** The instructions, without the front matter. */
  body: string
}

/** Every skill that ships with this package. */
export function builtinSkills(): Skill[] {
  return SKILLS
}

/** One skill by name, or null. */
export function findSkill(name: string): Skill | null {
  return SKILLS.find((skill) => skill.name === name) ?? null
}
