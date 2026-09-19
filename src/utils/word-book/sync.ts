import type { WordBookRecord } from "./types"

/**
 * Result of `wordBookAdd`: the stored record plus whether it was newly created,
 * so the caller can say "already saved" instead of stacking a duplicate.
 */
export interface WordBookAddResult {
  record: WordBookRecord
  created: boolean
}

/** Sync reasons that are not Notion's own error codes, stored on the record. */
export const WORD_BOOK_SYNC_ERROR = {
  NOT_CONFIGURED: "notion_not_configured",
  MAPPING_MISSING: "notion_mapping_missing",
} as const

export type WordBookSyncErrorCode = (typeof WORD_BOOK_SYNC_ERROR)[keyof typeof WORD_BOOK_SYNC_ERROR]

export type { WordBookDraft, WordBookRecord, WordBookSyncStatus } from "./types"
