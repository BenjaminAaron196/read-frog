import type { LearningProfile } from "@/utils/learning-mode/types"

/**
 * `chrome.storage.local` keys for the downloaded/imported dictionary. The
 * content script reads these directly (extension storage is reachable from a
 * content script), so no multi-megabyte payload has to cross the message bus.
 */
export const LEARNING_DICTIONARY_META_KEY = "learning-mode:dictionary-meta"
export const LEARNING_DICTIONARY_ENTRIES_KEY = "learning-mode:dictionary-entries"

/**
 * Deliberately untyped, like `DEFAULT_WORD_BOOK_CONFIG`: annotating it with the
 * schema's own type would make the schema and its default reference each other.
 */
export const DEFAULT_LEARNING_MODE_CONFIG = {
  /**
   * Off by default: the feature needs a dictionary artifact before it can mark
   * anything, so switching it on before an import would look broken.
   */
  enabled: false,
  profile: {
    kind: "cefr" as const,
    exam: "cet6",
    cefrLevel: "B1",
    vocabSize: 8000,
  },
  display: {
    showDensityHint: true,
    /** 0.3-1 multiplier over the tier palette. */
    intensity: 1,
    /**
     * Underline / wash can be switched off independently: a reader who wants
     * the marks to stay quiet keeps the underline and drops the background.
     */
    underline: true,
    wash: true,
  },
  /** Site patterns where the learning mode stays off; same syntax as site rules. */
  excludedPatterns: [] as string[],
  /**
   * Hard stop for pathological pages: beyond this many marks the run degrades
   * to "viewport only" so a 300k-character page cannot stall the tab.
   */
  maxHighlightsPerPage: 4000,
} satisfies {
  enabled: boolean
  profile: LearningProfile
  display: {
    showDensityHint: boolean
    intensity: number
    underline: boolean
    wash: boolean
  }
  excludedPatterns: string[]
  maxHighlightsPerPage: number
}
