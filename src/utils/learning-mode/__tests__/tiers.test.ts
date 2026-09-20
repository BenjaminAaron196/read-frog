import type { LearningDictionaryEntry, LearningProfile } from "../types"
import { describe, expect, it } from "vitest"
import { classifyEntry, describeProfile, isBelowAlwaysKnownThreshold } from "../tiers"

function entry(overrides: Partial<LearningDictionaryEntry>): LearningDictionaryEntry {
  return { w: "word", ...overrides }
}

function profile(overrides: Partial<LearningProfile>): LearningProfile {
  return { kind: "cefr", exam: "cet6", cefrLevel: "B1", vocabSize: 8000, ...overrides }
}

describe("classifyEntry", () => {
  describe("exam profile", () => {
    it("marks syllabus words and ignores the rest", () => {
      expect(
        classifyEntry(
          entry({ tags: ["cet6"], frq: 3000 }),
          profile({ kind: "exam", exam: "cet6" }),
        ),
      ).toBe("tier1")
      expect(
        classifyEntry(
          entry({ tags: ["cet4"], frq: 3000 }),
          profile({ kind: "exam", exam: "cet6" }),
        ),
      ).toBe(null)
      expect(classifyEntry(entry({ frq: 3000 }), profile({ kind: "exam", exam: "cet6" }))).toBe(
        null,
      )
    })

    it("scales the tier with how rare the word is inside the syllabus", () => {
      const cet6 = profile({ kind: "exam", exam: "cet6" })
      expect(classifyEntry(entry({ tags: ["cet6"], frq: 4500 }), cet6)).toBe("tier1")
      expect(classifyEntry(entry({ tags: ["cet6"], frq: 9000 }), cet6)).toBe("tier2")
      expect(classifyEntry(entry({ tags: ["cet6"], frq: 20000 }), cet6)).toBe("tier3")
      expect(classifyEntry(entry({ tags: ["cet6"] }), cet6)).toBe("tier3")
    })
  })

  describe("cefr profile", () => {
    it("marks only what sits above the reader's band", () => {
      const reader = profile({ kind: "cefr", cefrLevel: "B1" })
      expect(classifyEntry(entry({ cefr: "A2", frq: 1000 }), reader)).toBe(null)
      expect(classifyEntry(entry({ cefr: "B1", frq: 2000 }), reader)).toBe(null)
      expect(classifyEntry(entry({ cefr: "B2", frq: 4000 }), reader)).toBe("tier1")
      expect(classifyEntry(entry({ cefr: "C1", frq: 8000 }), reader)).toBe("tier2")
      expect(classifyEntry(entry({ cefr: "C2", frq: 15000 }), reader)).toBe("tier3")
    })

    it("ranks words outside the CEFR list by corpus frequency and drops the unranked ones", () => {
      expect(classifyEntry(entry({ frq: 3000 }), profile({ kind: "cefr", cefrLevel: "A2" }))).toBe(
        "tier1",
      )
      expect(classifyEntry(entry({ frq: 9000 }), profile({ kind: "cefr", cefrLevel: "B1" }))).toBe(
        "tier2",
      )
      expect(classifyEntry(entry({ frq: 30000 }), profile({ kind: "cefr", cefrLevel: "B1" }))).toBe(
        "tier3",
      )
      // No CEFR band and no corpus presence: jargon and names, not vocabulary.
      expect(classifyEntry(entry({}), profile({ kind: "cefr", cefrLevel: "B1" }))).toBe(null)
    })
  })

  describe("vocabSize profile", () => {
    it("marks words less frequent than the reader's estimated vocabulary", () => {
      const reader = profile({ kind: "vocabSize", vocabSize: 8000 })
      expect(classifyEntry(entry({ frq: 5000 }), reader)).toBe(null)
      expect(classifyEntry(entry({ frq: 9000 }), reader)).toBe("tier1")
      expect(classifyEntry(entry({ frq: 30000 }), reader)).toBe("tier2")
      expect(classifyEntry(entry({ frq: 90000 }), reader)).toBe("tier3")
    })

    it("falls back to the BNC rank when the contemporary one is missing", () => {
      expect(
        classifyEntry(entry({ bnc: 3000 }), profile({ kind: "vocabSize", vocabSize: 8000 })),
      ).toBe(null)
      expect(
        classifyEntry(entry({ bnc: 40000 }), profile({ kind: "vocabSize", vocabSize: 8000 })),
      ).toBe("tier2")
    })

    it("treats an unranked word as rare", () => {
      expect(classifyEntry(entry({}), profile({ kind: "vocabSize", vocabSize: 8000 }))).toBe(
        "tier3",
      )
    })
  })
})

describe("isBelowAlwaysKnownThreshold", () => {
  it("suppresses the highest-frequency function words", () => {
    expect(isBelowAlwaysKnownThreshold(entry({ frq: 300 }))).toBe(true)
    expect(isBelowAlwaysKnownThreshold(entry({ frq: 4000 }))).toBe(false)
    expect(isBelowAlwaysKnownThreshold(entry({}))).toBe(false)
  })
})

describe("describeProfile", () => {
  it("names the active profile for the density hint and the options preview", () => {
    expect(describeProfile(profile({ kind: "exam", exam: "cet6" }))).toBe("CET6")
    expect(describeProfile(profile({ kind: "cefr", cefrLevel: "B2" }))).toBe("CEFR B2")
    expect(describeProfile(profile({ kind: "vocabSize", vocabSize: 6000 }))).toBe("6000 words")
  })
})
