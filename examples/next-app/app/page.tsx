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

/**
 * The notice a corpus needs under every answer.
 *
 * A corpus whose data belongs to somebody else usually comes with terms that
 * require one, and the terms differ per game. So this is read from the corpus
 * directory rather than written into the app: point the app at another game and
 * the notice follows the data.
 */
function legalNote(dir: string) {
  try {
    const text = readFileSync(resolve(dir, "NOTICE.txt"), "utf8").trim()
    return text ? <span>{text}</span> : null
  } catch {
    return null
  }
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
      legalNote={legalNote(CORPUS_DIR)}
      suggestions={[
        "What does rule 100.1 say?",
        "What is Shield?",
        "Is Called Shot banned?",
        "How does combat damage work?",
      ]}
    />
  )
}
