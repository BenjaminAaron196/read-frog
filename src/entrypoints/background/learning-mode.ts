import type { LearningWordState } from "@/utils/learning-mode/types"
import { db } from "@/utils/db/dexie/db"
import { Sha256Hex } from "@/utils/hash"
import { clearDictionary, readDictionaryMeta } from "@/utils/learning-mode/lookup"
import { parseWordCardAiResult } from "@/utils/learning-mode/word-card-schema"
import { onMessage } from "@/utils/message"
import { generateTextForProviderRef } from "./background-stream"

/**
 * Everything the learning mode keeps outside the page.
 *
 * The verdicts live in IndexedDB, which a content script cannot open, so they
 * are read and written here. The dictionary does not: the options page writes it
 * straight into `chrome.storage.local` and the content script reads it from
 * there, so the background only has to report and clear it — a payload of tens
 * of thousands of entries has no business crossing the message bus.
 */
export function setupLearningModeMessageHandlers(): void {
  onMessage("learningWordStateList", () => db.learningWordState.toArray())

  onMessage("learningWordStateSet", async ({ data }) => {
    // The table is keyed by the lowercased headword, so the write boundary is
    // where that has to hold: a stray capital would otherwise become a second
    // row for the same word and leave the first verdict in place.
    const word = data.word.trim().toLowerCase()
    if (word === "") return

    const now = Date.now()
    // Keyed by word, so a family list that repeats the headword is still one row.
    const rows = new Map<string, LearningWordState>([
      [word, { word, state: data.state, updatedAt: now }],
    ])

    // Only a verdict that silences a mark spreads across the family: a reader
    // knows `perceive` and therefore `perceived`, but marking one form as being
    // learned says nothing about the others.
    if (data.state === "known" || data.state === "ignored") {
      for (const form of data.family ?? []) {
        const familyWord = form.trim().toLowerCase()
        if (familyWord !== "" && !rows.has(familyWord)) {
          rows.set(familyWord, { word: familyWord, state: data.state, updatedAt: now })
        }
      }
    }

    await db.learningWordState.bulkPut([...rows.values()])
  })

  onMessage("learningWordStateClear", async ({ data }) => {
    await db.learningWordState.delete(data.word.trim().toLowerCase())
  })

  onMessage("learningDictionaryStatus", () => readDictionaryMeta())

  onMessage("learningDictionaryClear", () => clearDictionary())

  /**
   * The word card's contextual answer. Cached by word + sentence + provider:
   * the page repeats the same sentence as the reader scans, and a hover is a
   * cheap event that must not become an API call each time it happens.
   */
  onMessage("learningWordExplain", async ({ data }) => {
    const providerIdentity = `${data.providerRef.config.provider}:${data.providerRef.config.id}`
    const cacheKey = Sha256Hex(data.word.toLowerCase(), data.sentence, providerIdentity)

    const cached = await db.learningWordCache.get(cacheKey)
    if (cached) {
      const parsed = parseWordCardAiResult(cached.payload)
      if (parsed) return parsed
    }

    const text = await generateTextForProviderRef({
      providerRef: data.providerRef,
      instructions: data.instructions,
      prompt: data.prompt,
      maxRetries: 0,
    })

    const result = parseWordCardAiResult(text)
    if (!result) return null
    await db.learningWordCache.put({
      key: cacheKey,
      payload: JSON.stringify(result),
      createdAt: Date.now(),
    })

    return result
  })
}
