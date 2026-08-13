// Eve names a skill after its file, so this filename IS `rulings_lookup`.
//
// The procedure itself lives once, in `@rulekitai/rulekit/agent/skills`, and both runtimes
// read it from there. Eve holds only the wiring, so a change to the procedure
// reaches this template with no edit here.
//
// `eveSkill` reads the `requires-tool` field of the procedure and switches it
// off for a corpus that holds no ruling, because Eve reads this directory and
// cannot drop a file.
import { eveSkill } from "../../lib/rules-tools.ts"

export default eveSkill("rulings_lookup")
