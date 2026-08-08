import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { AskScreen } from "./ask-screen.tsx"

/**
 * The one page.
 *
 * It reads the profile on the server so the interface can be labelled with the
 * game's own name and suggestions, then hands that to a client component. The
 * corpus never reaches the browser.
 */

const CORPUS_DIR = resolve(process.cwd(), "..", "..", process.env.RULEKIT_CORPUS ?? "data/riftbound")

type ProfileFile = {
  game?: { name?: string; description?: string }
  cards?: { linkScheme?: string }
}

export default function Page() {
  let profile: ProfileFile = {}
  try {
    profile = JSON.parse(readFileSync(resolve(CORPUS_DIR, "profile.json"), "utf8")) as ProfileFile
  } catch {
    // A corpus with no profile still answers questions. Only the labels below
    // fall back to something generic.
  }
  const name = profile.game?.name ?? "this game"

  return (
    <AskScreen
      title={`Ask about ${name}`}
      subtitle={
        "Every answer is read from the rules data and cited. " +
        "It is an unofficial reference, not a ruling."
      }
      cardScheme={profile.cards?.linkScheme ?? "card"}
      suggestions={[
        "What does rule 100.1 say?",
        "What is Shield?",
        "Is Called Shot banned?",
        "How does combat damage work?",
      ]}
    />
  )
}
