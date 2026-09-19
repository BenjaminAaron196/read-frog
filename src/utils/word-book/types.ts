/** One saved vocabulary entry, as stored locally and synced to Notion. */
export interface WordBookRecord {
  id: string
  word: string
  /** Definition text from the dictionary action; may span lines. */
  definition: string
  /** The sentence (or subtitle cue) the word was picked from. */
  context: string
  sourceUrl: string
  sourceTitle: string
  addedAt: number
  /** Notion page once the sync succeeded. */
  notionPageId?: string
  notionUrl?: string
  syncStatus: WordBookSyncStatus
  syncError?: string
  syncAttempts: number
}

export type WordBookSyncStatus = "pending" | "created" | "failed"

export interface WordBookDraft {
  word: string
  definition: string
  context: string
  sourceUrl: string
  sourceTitle: string
}
