import { Entity } from "dexie"

/**
 * One AI answer for one word in one sentence, kept under
 * `sha256(word, sentence, provider)`.
 *
 * A cache, not user data: the cleanup job in `background/db-cleanup.ts` may
 * drop it, and nothing on the page depends on a row being there. `payload` is
 * the serialized result rather than a typed object, so a later change to the
 * card's shape cannot make an old row unreadable — the reader of this table
 * parses it with the current schema and falls back to a fresh request.
 */
export default class LearningWordCacheEntry extends Entity {
  key!: string

  payload!: string

  createdAt!: number
}
