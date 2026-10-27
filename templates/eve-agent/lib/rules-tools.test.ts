import assert from "node:assert/strict"
import test from "node:test"
import { builtinSkills } from "@rulekitai/rulekit/agent/skills"
import { eveSkill, TOOL_NAMES } from "./rules-tools.ts"

test("offers only procedures whose required tools exist in the real corpus", async () => {
  for (const skill of builtinSkills()) {
    const definition = eveSkill(skill.name)
    if (skill.requiresTool && !TOOL_NAMES.includes(skill.requiresTool)) {
      assert.ok(!("content" in definition), `${skill.name} must resolve dynamically to nothing`)
      assert.equal(await Reflect.apply(definition.evaluate, undefined, []), null)
    } else {
      assert.ok("content" in definition, `${skill.name} must remain loadable`)
      assert.equal(definition.content, skill.body)
    }
  }
})
