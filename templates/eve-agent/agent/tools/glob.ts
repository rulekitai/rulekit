// No filesystem. The corpus is reached through its own tools.
//
// Eve 0.39.0 took this tool out of the default set, so an agent gets it only
// by exporting defineGlobTool() or defineGrepTool() from a file here. This file
// stays as the standing decision, and it also holds if a later Eve puts the
// tool back. disableTool() still resolves, because Eve keeps both names on its
// framework tool list.
import { disableTool } from "eve/tools"

export default disableTool()
