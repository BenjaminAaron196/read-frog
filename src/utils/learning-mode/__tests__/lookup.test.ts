import type { LearningDictionaryEntry, LearningProfile, LearningWordState } from "../types"
import { describe, expect, it } from "vitest"
import {
  buildDictionaryIndex,
  collectSuppressedWords,
  collectWordFamily,
  createWordMatcher,
  normalizeToken,
} from "../lookup"

const PROFILE: LearningProfile = {
  kind: "cefr",
  exam: "cet6",
  cefrLevel: "B1",
  vocabSize: 8000,
}

function entry(overrides: Partial<LearningDictionaryEntry>): LearningDictionaryEntry {
  return { w: "word", frq: 9000, ...overrides }
}

describe("normalizeToken", () => {
  it("lowercases, drops edge punctuation and strips the possessive", () => {
    expect(normalizeToken("Perceived,")).toBe("perceived")
    expect(normalizeToken("reader's")).toBe("reader")
    expect(normalizeToken("“negotiate”")).toBe("negotiate")
  })
})

describe("collectWordFamily", () => {
  it("reads ECDICT's exchange column as the family", () => {
    const family = collectWordFamily(
      entry({
        w: "perceive",
        l: "perceive",
        x: "d:perceived/p:perceived/3:perceives/i:perceiving/0:perceive",
      }),
    )
    expect(new Set(family)).toEqual(new Set(["perceive", "perceived", "perceives", "perceiving"]))
  })

  it("falls back to the headword alone", () => {
    expect(collectWordFamily(entry({ w: "solitude" }))).toEqual(["solitude"])
  })
})

describe("createWordMatcher", () => {
  const index = buildDictionaryIndex([
    entry({ w: "ubiquitous", frq: 9000, cefr: "C1" }),
    entry({ w: "the", frq: 1 }),
    entry({ w: "perceived", l: "perceive", frq: 3000, cefr: "B2" }),
  ])

  const matcher = createWordMatcher({ index, profile: PROFILE, suppressedWords: new Set() })

  it("marks a word above the reader's level and reports its tier", () => {
    expect(matcher("ubiquitous")?.tier).toBe("tier2")
    expect(matcher("ubiquitous")?.entry.w).toBe("ubiquitous")
  })

  it("keeps the page's surface form while matching through the lemma", () => {
    const match = matcher("perceived")
    expect(match?.entry.w).toBe("perceived")
    expect(match?.surface).toBe("perceived")
  })

  it("never marks the words everyone knows or words the dictionary lacks", () => {
    expect(matcher("the")).toBe(null)
    expect(matcher("zzz")).toBe(null)
    expect(matcher("a")).toBe(null)
  })

  it("honours the reader's own known/ignored state for the lemma family", () => {
    const suppressed = new Set(["perceive", "perceives"])
    const suppressedMatcher = createWordMatcher({
      index,
      profile: PROFILE,
      suppressedWords: suppressed,
    })
    expect(suppressedMatcher("perceived")).toBe(null)
  })
})

describe("collectSuppressedWords", () => {
  it("keeps only the states that silence a word", () => {
    const states: LearningWordState[] = [
      { word: "known-word", state: "known", updatedAt: 1 },
      { word: "ignored-word", state: "ignored", updatedAt: 1 },
      { word: "studying-word", state: "learning", updatedAt: 1 },
    ]
    expect(collectSuppressedWords(states)).toEqual(new Set(["known-word", "ignored-word"]))
  })
})
