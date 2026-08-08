import { tokenize } from "./text.ts"

/**
 * A small BM25 index, in plain JavaScript.
 *
 * The SQLite store gets its ranking from the full-text engine that ships with
 * Node. An edge runtime has no filesystem and no SQLite, so the JSON store needs
 * its own. BM25 is the same family of ranking the database uses: a document
 * scores for holding a query word, more when the word is rare across the
 * collection, and less as the document gets longer.
 *
 * A corpus of a few thousand rules indexes in well under a second and searches
 * in about a millisecond, so nothing here needs to be clever.
 */

/** Saturation. How fast repeating a word stops adding score. The usual value. */
const K1 = 1.2
/** Length normalisation. 0 ignores document length, 1 divides by it fully. */
const B = 0.75

export type Field = { text: string; weight: number }

type Posting = { doc: number; count: number }

export class Bm25Index<T> {
  #docs: T[] = []
  /** token -> the documents holding it, with a weighted count. */
  #postings = new Map<string, Posting[]>()
  #lengths: number[] = []
  #averageLength = 0

  /**
   * Build an index.
   *
   * `fields` returns the searchable text of one document, with a weight per
   * field. A weighted field contributes its words more than once, which is how
   * a match in a title outranks the same match buried in a body.
   */
  constructor(items: T[], fields: (item: T) => Field[]) {
    let total = 0
    items.forEach((item, doc) => {
      this.#docs.push(item)
      const counts = new Map<string, number>()
      let length = 0
      for (const field of fields(item)) {
        const weight = Math.max(0, field.weight)
        if (!weight) continue
        for (const token of tokenize(field.text)) {
          counts.set(token, (counts.get(token) ?? 0) + weight)
          length += weight
        }
      }
      for (const [token, count] of counts) {
        const list = this.#postings.get(token)
        if (list) list.push({ doc, count })
        else this.#postings.set(token, [{ doc, count }])
      }
      this.#lengths.push(length)
      total += length
    })
    this.#averageLength = items.length ? total / items.length : 0
  }

  /** The best `limit` matches, highest score first. Empty when nothing matches. */
  search(query: string, limit = 20): { item: T; score: number }[] {
    const tokens = [...new Set(tokenize(query))]
    if (!tokens.length) return []
    const total = this.#docs.length
    if (!total) return []

    const scores = new Map<number, number>()
    for (const token of tokens) {
      const postings = this.#postings.get(token)
      if (!postings) continue
      // The rarer the word, the more a match on it says. A word in almost every
      // document scores near zero, which is why no stopword list is needed for
      // correctness here.
      const idf = Math.log(1 + (total - postings.length + 0.5) / (postings.length + 0.5))
      for (const { doc, count } of postings) {
        const length = this.#lengths[doc] ?? 0
        const norm = this.#averageLength ? length / this.#averageLength : 1
        const tf = (count * (K1 + 1)) / (count + K1 * (1 - B + B * norm))
        scores.set(doc, (scores.get(doc) ?? 0) + idf * tf)
      }
    }

    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(1, limit))
      .map(([doc, score]) => ({ item: this.#docs[doc] as T, score }))
  }
}
