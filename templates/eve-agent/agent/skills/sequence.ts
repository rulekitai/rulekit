// Eve names a skill after its file, so this filename IS `sequence`.
//
// The procedure itself lives once, in `@rulekitai/rulekit/agent/skills`, and both runtimes
// read it from there. Eve holds only the wiring, so a change to the procedure
// reaches this template with no edit here.
import { findSkill } from "@rulekitai/rulekit/agent/skills"
import { defineSkill } from "eve/skills"

const skill = findSkill("sequence")
if (!skill) throw new Error("the sequence skill is missing from @rulekitai/rulekit/agent/skills")

export default defineSkill({ description: skill.description, markdown: skill.body })
