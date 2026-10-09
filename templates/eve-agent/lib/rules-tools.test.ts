import assert from "node:assert/strict"
import test from "node:test"
import { builtinSkills } from "@rulekitai/rulekit/agent/skills"
import { eveSkill, TOOL_NAMES } from "./rules-tools.ts"

test("offers only procedures whose required tools exist in the real corpus", async () => {
  for (const skill of builtinSkills()) {
    const definition = eveSkill(skill.name)
    if (skill.requiresTool && !TOOL_NAMES.includes(skill.requiresTool)) {
      assert.ok("events" in definition, `${skill.name} must resolve dynamically to nothing`)
      const resolve = definition.events["session.started"]
      assert.ok(resolve)
      assert.equal(await Reflect.apply(resolve, undefined, []), null)
    } else {
      assert.ok("markdown" in definition, `${skill.name} must remain loadable`)
      assert.equal(definition.markdown, skill.body)
    }
  }
})
