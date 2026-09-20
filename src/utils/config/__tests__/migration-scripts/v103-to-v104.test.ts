import { describe, expect, it } from "vitest"
import { migrate } from "../../migration-scripts/v103-to-v104"

/** A stored v103 config: the arbitrary shape the frozen script is handed. */
const V103_CONFIG = {
  uiLanguage: "zh-CN",
  providersConfig: [{ id: "openai", apiKey: "sk-123" }],
  learningMode: {
    enabled: true,
    profile: { kind: "cefr", exam: "cet6", cefrLevel: "B1", vocabSize: 8000 },
    display: { showDensityHint: true, intensity: 1, underline: true, wash: true },
    excludedPatterns: ["*://*.example.com/*"],
    maxHighlightsPerPage: 4000,
  },
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readLearningMode(config: unknown): Record<string, unknown> {
  if (!isConfigObject(config)) throw new Error("migration must return a config object")
  const section = config.learningMode
  if (!isConfigObject(section)) throw new Error("learningMode must survive as an object")
  return section
}

describe("v103 to v104 migration", () => {
  it("adds the new learning-mode fields and keeps the reader's own settings", () => {
    const section = readLearningMode(migrate(V103_CONFIG))

    expect(section.ai).toEqual({ enabled: true, maxRequestsPerPage: 20 })
    expect(section.dictionarySources).toEqual([])
    expect(section.display).toMatchObject({ minTier: "all", wash: true })
    // The reader's existing choices are untouched.
    expect(section.enabled).toBe(true)
    expect(section.excludedPatterns).toEqual(["*://*.example.com/*"])
    expect(section.maxHighlightsPerPage).toBe(4000)
  })

  it("keeps values a config already carries", () => {
    const section = readLearningMode(
      migrate({
        learningMode: {
          ...V103_CONFIG.learningMode,
          ai: { enabled: false, maxRequestsPerPage: 3 },
          dictionarySources: ["https://example.com/dict/"],
          display: {
            showDensityHint: false,
            intensity: 0.5,
            underline: false,
            wash: false,
            minTier: "tier2",
          },
        },
      }),
    )

    expect(section.ai).toEqual({ enabled: false, maxRequestsPerPage: 3 })
    expect(section.dictionarySources).toEqual(["https://example.com/dict/"])
    expect(section.display).toMatchObject({ minTier: "tier2" })
  })

  it("is idempotent and leaves a config without the section alone", () => {
    const once = migrate(V103_CONFIG)
    expect(migrate(once)).toEqual(once)

    const withoutSection = { uiLanguage: "en" }
    expect(migrate(withoutSection)).toEqual(withoutSection)
  })
})
