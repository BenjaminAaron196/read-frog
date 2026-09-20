import type { LearningWordStateKind } from "@/utils/learning-mode/types"
import { Entity } from "dexie"

/**
 * The reader's verdict on one word. `known` and `ignored` both silence its mark,
 * `learning` keeps it marked and is what the hover card's word-book action
 * records; only the first two are stamped across the word's family.
 *
 * Keyed by the lowercased headword, so one verdict covers every surface form and
 * every page, and `put` is the whole upsert. Like the word book this is user
 * data — `background/db-cleanup.ts` registers jobs per table by hand, and this
 * one gets none.
 */
export default class LearningWordStateEntry extends Entity {
  word!: string

  state!: LearningWordStateKind

  updatedAt!: number
}
