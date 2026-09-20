import { describe, expect, it } from "vitest"
import { migrate } from "../../migration-scripts/v102-to-v103"

/** A stored v102 config: the arbitrary shape the frozen script is handed. */
const V102_CONFIG = {
  uiLanguage: "zh-CN",
  language: { sourceCode: "auto", targetCode: "cmn", level: "intermediate" },
  providersConfig: [{ id: "openai", apiKey: "sk-123" }],
  glossary: { enabled: true },
  wordBook: {
    enabled: true,
    notion: { apiKey: "", databaseId: "", mappings: [] },
  },
  siteRules: { userRules: [], disabledBuiltInRules: [] },
}

/** `migrate` takes and returns unvalidated input, so the tests read it back the same way. */
function isConfigObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

const LEARNING_MODE_DEFAULTS = {
  enabled: false,
  profile: { kind: "cefr", exam: "cet6", cefrLevel: "B1", vocabSize: 8000 },
  display: { showDensityHint: true, intensity: 1, underline: true, wash: true },
  excludedPatterns: [],
  maxHighlightsPerPage: 4000,
}

describe("v102 to v103 migration", () => {
  it("adds the shipped learning-mode defaults and keeps the rest of the config", () => {
    const migrated = migrate(V102_CONFIG)
    if (!isConfigObject(migrated)) throw new Error("migration must return a config object")

    expect(migrated.learningMode).toEqual(LEARNING_MODE_DEFAULTS)
    // Off on arrival: without an imported dictionary the feature has nothing to
    // mark, so an upgrade must not switch it on under the reader.
    expect(migrated.learningMode).toHaveProperty("enabled", false)
    expect(migrated.providersConfig).toEqual([{ id: "openai", apiKey: "sk-123" }])
    expect(migrated.wordBook).toEqual({
      enabled: true,
      notion: { apiKey: "", databaseId: "", mappings: [] },
    })
  })

  it("keeps a learning mode the user already configured", () => {
    const existing = {
      enabled: true,
      profile: { kind: "vocabSize", exam: "gre", cefrLevel: "C1", vocabSize: 12000 },
      display: { showDensityHint: false, intensity: 0.5, underline: false, wash: true },
      excludedPatterns: ["*.example.com"],
      maxHighlightsPerPage: 2000,
    }

    const migrated = migrate({ ...V102_CONFIG, learningMode: existing })

    expect(isConfigObject(migrated) && migrated.learningMode).toEqual(existing)
  })

  it("is idempotent and tolerates configs that are not objects", () => {
    const once = migrate(V102_CONFIG)
    expect(migrate(once)).toEqual(once)

    expect(migrate(null)).toBeNull()
    expect(migrate("nonsense")).toBe("nonsense")
    expect(migrate([1, 2])).toEqual([1, 2])
  })
})
