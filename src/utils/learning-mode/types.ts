/**
 * Shared vocabulary shapes for the learning mode.
 *
 * Everything here is intentionally compact: the dictionary travels through
 * `chrome.storage.local` (the extension holds `unlimitedStorage`) and is parsed
 * once per page by the content script, so the entry format trades readability
 * for bytes. The build script (`scripts/learning-mode/build-dictionary.mjs`)
 * emits exactly this shape and the manifest that describes it.
 */

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const
export type CefrLevel = (typeof CEFR_LEVELS)[number]

/** ECDICT's `tag` column: exam syllabi a word belongs to. */
export const EXAM_TAGS = ["zk", "gk", "cet4", "cet6", "ky", "toefl", "ielts", "gre"] as const
export type ExamTag = (typeof EXAM_TAGS)[number]

export type LearningProfileKind = "exam" | "cefr" | "vocabSize"

export interface LearningProfile {
  kind: LearningProfileKind
  exam: ExamTag
  cefrLevel: CefrLevel
  vocabSize: number
}

/**
 * One dictionary row. Field names are single letters because a 60k-entry
 * artifact is shipped as JSON; `w`/`l` are lowercased.
 */
export interface LearningDictionaryEntry {
  /** word */
  w: string
  /** lemma, only when it differs from `w` */
  l?: string
  /** phonetic transcription */
  p?: string
  /** Chinese senses, one per line in the source */
  t?: string[]
  /** English senses, one per line in the source */
  d?: string[]
  /** part-of-speech distribution, e.g. `n:46/v:54` */
  pos?: string
  /** Collins star rating (1-5) */
  col?: number
  /** Oxford 3000 core word */
  ox?: 1
  /** exam syllabi */
  tags?: ExamTag[]
  /** contemporary-corpus frequency rank */
  frq?: number
  /** BNC frequency rank */
  bnc?: number
  /** ECDICT `exchange`: inflections and the lemma pointer */
  x?: string
  /** CEFR band from CEFR-J (absent for words outside its 7,801 items) */
  cefr?: CefrLevel
}

export interface LearningDictionaryMeta {
  version: string
  variant: "lite" | "full"
  entries: number
  bytes: number
  importedAt: number
  /** where the artifact came from: a URL, a file name, or a built-in fixture */
  source: string
}

export interface LearningDictionaryPayload {
  meta: LearningDictionaryMeta
  entries: LearningDictionaryEntry[]
}

export type LearningWordStateKind = "known" | "ignored" | "learning"

export interface LearningWordState {
  /** lowercased headword */
  word: string
  state: LearningWordStateKind
  updatedAt: number
}

/** Tier of a marked word; the display layer styles each tier differently. */
export type LearningTier = "tier1" | "tier2" | "tier3"

export interface MarkedWord {
  tier: LearningTier
  entry: LearningDictionaryEntry
}

/** Result of matching one page token against the dictionary + user state. */
export interface LearningMatch {
  tier: LearningTier
  entry: LearningDictionaryEntry
  /** the exact surface form found in the page */
  surface: string
}
