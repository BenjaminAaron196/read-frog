import type {
  LearningDictionaryEntry,
  LearningDictionaryMeta,
  LearningMatch,
  LearningProfile,
  LearningWordState,
} from "./types"
import { browser } from "#imports"
import {
  LEARNING_DICTIONARY_ENTRIES_KEY,
  LEARNING_DICTIONARY_META_KEY,
} from "@/utils/constants/learning-mode"
import { classifyEntry, isBelowAlwaysKnownThreshold } from "./tiers"

/**
 * The dictionary is read straight from extension storage rather than through
 * the background: a content script can use `chrome.storage.local`, and routing
 * a multi-megabyte payload through the message bus would cost more than the
 * parse it saves.
 */
export async function readDictionaryMeta(): Promise<LearningDictionaryMeta | null> {
  const stored = await browser.storage.local.get(LEARNING_DICTIONARY_META_KEY)
  return (stored[LEARNING_DICTIONARY_META_KEY] as LearningDictionaryMeta | undefined) ?? null
}

export async function readDictionaryEntries(): Promise<LearningDictionaryEntry[]> {
  const stored = await browser.storage.local.get(LEARNING_DICTIONARY_ENTRIES_KEY)
  return (stored[LEARNING_DICTIONARY_ENTRIES_KEY] as LearningDictionaryEntry[] | undefined) ?? []
}

export async function clearDictionary(): Promise<void> {
  await browser.storage.local.remove([
    LEARNING_DICTIONARY_META_KEY,
    LEARNING_DICTIONARY_ENTRIES_KEY,
  ])
}

/**
 * Two indexes over one dictionary: the surface form, and the lemma. A page says
 * `perceived`; the dictionary stores that row and points at `perceive`, which is
 * the row that carries the frequency rank and the exam tag — so a miss on the
 * surface form falls back to the lemma index before the word is given up on.
 */
export interface DictionaryIndex {
  byWord: Map<string, LearningDictionaryEntry>
  byLemma: Map<string, LearningDictionaryEntry>
}

export function buildDictionaryIndex(entries: LearningDictionaryEntry[]): DictionaryIndex {
  const byWord = new Map<string, LearningDictionaryEntry>()
  const byLemma = new Map<string, LearningDictionaryEntry>()

  for (const entry of entries) {
    byWord.set(entry.w, entry)
    if (entry.l && !byLemma.has(entry.l)) {
      byLemma.set(entry.l, entry)
    }
  }

  return { byWord, byLemma }
}

const TRAILING_POSSESSIVE = /['’]s$/
const EDGE_PUNCTUATION = /^[^a-z]+|[^a-z]+$/g
const MIN_INTERESTING_LENGTH = 3

/**
 * Page text carries punctuation, possessives and stray casing; the dictionary
 * only knows clean lowercase headwords.
 */
export function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(TRAILING_POSSESSIVE, "").replace(EDGE_PUNCTUATION, "")
}

export interface WordMatcher {
  (rawToken: string): LearningMatch | null
}

export interface CreateWordMatcherOptions {
  index: DictionaryIndex
  profile: LearningProfile
  /** Every lowercased form the reader has marked known or ignored. */
  suppressedWords: ReadonlySet<string>
}

/**
 * Turns a page token into a mark, or nothing. Both the personal state and the
 * profile are consulted in that order: a word the reader already vouched for is
 * never re-marked, whatever the profile thinks of it.
 *
 * The per-page run repeats the same function words thousands of times, so the
 * verdict is memoized per token.
 */
export function createWordMatcher({
  index,
  profile,
  suppressedWords,
}: CreateWordMatcherOptions): WordMatcher {
  const verdicts = new Map<string, LearningMatch | null>()

  return (rawToken: string): LearningMatch | null => {
    const token = normalizeToken(rawToken)
    if (token.length < MIN_INTERESTING_LENGTH) return null
    if (suppressedWords.has(token)) return null

    const cached = verdicts.get(token)
    if (cached !== undefined) return cached

    const entry = index.byWord.get(token) ?? index.byLemma.get(token)
    let match: LearningMatch | null = null

    if (entry) {
      const entryIsSuppressed =
        suppressedWords.has(entry.w) || (entry.l !== undefined && suppressedWords.has(entry.l))
      if (!entryIsSuppressed && !isBelowAlwaysKnownThreshold(entry)) {
        const tier = classifyEntry(entry, profile)
        if (tier) {
          match = { tier, entry, surface: token }
        }
      }
    }

    verdicts.set(token, match)
    return match
  }
}

/** The forms the profile must not mark, from the reader's own state. */
export function collectSuppressedWords(states: readonly LearningWordState[]): Set<string> {
  const suppressed = new Set<string>()
  for (const state of states) {
    if (state.state === "known" || state.state === "ignored") {
      suppressed.add(state.word)
    }
  }
  return suppressed
}

/**
 * The family a "known" verdict should carry with it: `perceive`, `perceived`
 * and `perceiving` are one word to a reader. ECDICT's `exchange` column lists
 * exactly those forms, so no lemmatizer is needed here.
 */
export function collectWordFamily(entry: LearningDictionaryEntry): string[] {
  const family = new Set<string>([entry.w])
  if (entry.l) family.add(entry.l)

  if (entry.x) {
    for (const part of entry.x.split("/")) {
      const [, form] = part.split(":")
      if (form) family.add(normalizeToken(form))
    }
  }

  return [...family].filter((form) => form.length > 0)
}
