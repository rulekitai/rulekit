// Eve names a skill after its file, so this filename IS `interaction`.
//
// The procedure itself lives once, in `@rulekitai/agent/skills`, and both runtimes
// read it from there. Eve holds only the wiring, so a change to the procedure
// reaches this template with no edit here.
import { findSkill } from "@rulekitai/agent/skills"
import { defineSkill } from "eve/skills"

const skill = findSkill("interaction")
if (!skill) throw new Error("the interaction skill is missing from @rulekitai/agent/skills")

export default defineSkill({ description: skill.description, markdown: skill.body })
