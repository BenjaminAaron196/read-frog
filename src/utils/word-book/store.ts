import type { WordBookDraft, WordBookRecord } from "./types"

/** How many entries stay on disk; the list is a reading aid, not an archive. */
const MAX_WORD_BOOK_RECORDS = 5000

export interface WordBookStorage {
  read: () => Promise<WordBookRecord[]>
  write: (records: WordBookRecord[]) => Promise<void>
}

export interface WordBookStore {
  list: () => Promise<WordBookRecord[]>
  add: (draft: WordBookDraft) => Promise<{ record: WordBookRecord; created: boolean }>
  remove: (id: string) => Promise<void>
  markSynced: (id: string, page: { id: string; url: string }) => Promise<WordBookRecord | null>
  markFailed: (id: string, error: string) => Promise<WordBookRecord | null>
  markPending: (id: string, reason: string) => Promise<WordBookRecord | null>
  /** Records still owing a write, oldest first - the sync sweep's work list. */
  listPending: () => Promise<WordBookRecord[]>
}

function normalizeWord(word: string): string {
  return word.trim().toLowerCase()
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function createWordBookStore(storage: WordBookStorage): WordBookStore {
  return {
    list: () => storage.read(),

    /**
     * Saving the same word from the same page twice returns the first entry
     * instead of stacking duplicates; a different page is a different sighting
     * and gets its own row.
     */
    add: async (draft) => {
      const records = await storage.read()
      const existing = records.find(
        (record) =>
          normalizeWord(record.word) === normalizeWord(draft.word) &&
          record.sourceUrl === draft.sourceUrl,
      )
      if (existing) {
        return { record: existing, created: false }
      }

      const record: WordBookRecord = {
        id: createId(),
        word: draft.word.trim(),
        definition: draft.definition.trim(),
        context: draft.context.trim(),
        sourceUrl: draft.sourceUrl,
        sourceTitle: draft.sourceTitle,
        addedAt: Date.now(),
        syncStatus: "pending",
        syncAttempts: 0,
      }

      const next = [record, ...records].slice(0, MAX_WORD_BOOK_RECORDS)
      await storage.write(next)
      return { record, created: true }
    },

    remove: async (id) => {
      const records = await storage.read()
      await storage.write(records.filter((record) => record.id !== id))
    },

    markSynced: async (id, page) => {
      return await updateRecord(storage, id, (record) => ({
        ...record,
        notionPageId: page.id,
        notionUrl: page.url,
        syncStatus: "created",
        syncError: undefined,
      }))
    },

    markFailed: async (id, error) => {
      return await updateRecord(storage, id, (record) => ({
        ...record,
        syncStatus: "failed",
        syncError: error,
        syncAttempts: record.syncAttempts + 1,
      }))
    },

    /**
     * Not a failure the entry can do anything about: it is still queued, so the
     * row keeps waiting for a connection instead of showing an error, and the
     * reason rides along for the tooltip. No attempt is counted, because no
     * request went out.
     */
    markPending: async (id, reason) => {
      return await updateRecord(storage, id, (record) => ({
        ...record,
        syncStatus: "pending",
        syncError: reason,
      }))
    },

    listPending: async () => {
      const records = await storage.read()
      return records
        .filter((record) => record.syncStatus !== "created")
        .sort((left, right) => left.addedAt - right.addedAt)
    },
  }
}

async function updateRecord(
  storage: WordBookStorage,
  id: string,
  patch: (record: WordBookRecord) => WordBookRecord,
): Promise<WordBookRecord | null> {
  const records = await storage.read()
  const index = records.findIndex((record) => record.id === id)
  if (index === -1) {
    return null
  }

  const updated = patch(records[index]!)
  const next = [...records]
  next[index] = updated
  await storage.write(next)
  return updated
}

/** Cap exposed for tests and for the options page copy. */
export { MAX_WORD_BOOK_RECORDS }
