import type { CefrLevel, LearningDictionaryEntry, LearningProfile, LearningTier } from "./types"

/**
 * The tier rules live in one place so the content script and the options
 * preview cannot disagree about what a given profile marks.
 *
 * Tiers are about how "far" a word sits from the reader's target level, and the
 * palette scales with them: tier1 is a nudge, tier3 is the loudest mark.
 */

const CEFR_INDEX: Record<CefrLevel, number> = {
  A1: 0,
  A2: 1,
  B1: 2,
  B2: 3,
  C1: 4,
  C2: 5,
}

function frequencyRank(entry: LearningDictionaryEntry): number | undefined {
  // `frq` is the contemporary corpus; `bnc` is the historical one. Reading the
  // web is the common case, so the contemporary rank leads.
  return entry.frq ?? entry.bnc
}

/**
 * Frequency bands used by the exam profile (and as the fallback for words the
 * CEFR list does not carry): inside 5k is "core", 5k-12k is "useful", beyond
 * that (or unranked) is "rare".
 */
const FREQ_BAND_TIER1 = 5000
const FREQ_BAND_TIER2 = 12000

function tierFromFrequencyRank(rank: number | undefined): LearningTier {
  if (rank === undefined) return "tier3"
  if (rank <= FREQ_BAND_TIER1) return "tier1"
  if (rank <= FREQ_BAND_TIER2) return "tier2"
  return "tier3"
}

function tierFromCefrDistance(distance: number): LearningTier {
  if (distance <= 1) return "tier1"
  if (distance <= 2) return "tier2"
  return "tier3"
}

/**
 * Whether the profile wants this word marked, and how loudly.
 *
 * - `exam`: the word belongs to the syllabus the reader is studying. The list
 *   itself is the study material, so membership is what earns a mark.
 * - `cefr`: anything above the reader's own band; words outside the CEFR list
 *   are treated as beyond B2.
 * - `vocabSize`: anything less frequent than the reader's estimated vocabulary.
 */
export function classifyEntry(
  entry: LearningDictionaryEntry,
  profile: LearningProfile,
): LearningTier | null {
  switch (profile.kind) {
    case "exam": {
      if (!entry.tags?.includes(profile.exam)) return null
      return tierFromFrequencyRank(frequencyRank(entry))
    }
    case "cefr": {
      const rank = frequencyRank(entry)
      if (!entry.cefr) {
        // No CEFR band AND no corpus presence means the dictionary cannot say
        // this word is worth a reader's attention — jargon and names land here,
        // and marking them buries the words that matter.
        if (rank === undefined) return null
        return tierFromFrequencyRank(rank)
      }
      const distance = CEFR_INDEX[entry.cefr] - CEFR_INDEX[profile.cefrLevel]
      if (distance <= 0) return null
      return tierFromCefrDistance(distance)
    }
    case "vocabSize": {
      const rank = frequencyRank(entry)
      if (rank === undefined) return "tier3"
      if (rank <= profile.vocabSize) return null
      if (rank <= profile.vocabSize * 2) return "tier1"
      if (rank <= profile.vocabSize * 5) return "tier2"
      return "tier3"
    }
    default:
      return null
  }
}

/**
 * Words a reader is unlikely to need help with, regardless of profile: the
 * highest-frequency function words are known by anyone reading a page in that
 * language, and marking them would bury the signal.
 */
const ALWAYS_KNOWN_FREQ_RANK = 1200

export function isBelowAlwaysKnownThreshold(entry: LearningDictionaryEntry): boolean {
  const rank = frequencyRank(entry)
  return rank !== undefined && rank <= ALWAYS_KNOWN_FREQ_RANK
}

/** The threshold the density hint and the profile preview both report against. */
const PROFILE_LABEL: Record<LearningProfile["kind"], (profile: LearningProfile) => string> = {
  exam: (profile) => profile.exam.toUpperCase(),
  cefr: (profile) => `CEFR ${profile.cefrLevel}`,
  vocabSize: (profile) => `${profile.vocabSize} words`,
}

export function describeProfile(profile: LearningProfile): string {
  return PROFILE_LABEL[profile.kind](profile)
}
