import type { WordBookSyncStatus } from "@/utils/word-book/types"
import { Entity } from "dexie"

/**
 * A saved word: text the user collected, not regenerable cache. Like the
 * glossary it therefore gets no cleanup job — `background/db-cleanup.ts`
 * registers jobs per table by hand — and relies on the extension's
 * `unlimitedStorage` permission.
 *
 * `syncStatus`/`syncAttempts`/`syncError` are the Notion write's state:
 * a row is written locally first and only then pushed, so nothing is lost when
 * the token is missing or the network is down.
 */
export default class WordBookEntry extends Entity {
  id!: string

  word!: string

  /** Definition text from the dictionary action; may span lines. */
  definition!: string

  /** The sentence (or subtitle cue) the word was picked from. */
  context!: string

  sourceUrl!: string

  sourceTitle!: string

  addedAt!: number

  notionPageId?: string

  notionUrl?: string

  syncStatus!: WordBookSyncStatus

  syncError?: string

  syncAttempts!: number
}
