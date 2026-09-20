import { describe, expect, it } from "vitest"
import { migrate } from "../../migration-scripts/v104-to-v105"

/** A stored v104 config: the arbitrary shape the frozen script is handed. */
const V104_CONFIG = {
  uiLanguage: "zh-CN",
  providersConfig: [{ id: "openai", apiKey: "sk-123" }],
  learningMode: {
    enabled: true,
    profile: { kind: "cefr", exam: "cet6", cefrLevel: "B1", vocabSize: 8000 },
    display: {
      showDensityHint: false,
      intensity: 0.8,
      underline: true,
      wash: false,
      minTier: "tier2",
    },
    excludedPatterns: ["*://*.example.com/*"],
    maxHighlightsPerPage: 4000,
  },
}

function isConfigObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function readDisplay(config: unknown): Record<string, unknown> {
  if (!isConfigObject(config)) throw new Error("migration must return a config object")
  const section = config.learningMode
  if (!isConfigObject(section)) throw new Error("learningMode must survive as an object")
  const display = section.display
  if (!isConfigObject(display)) throw new Error("display must survive as an object")
  return display
}

describe("v104 to v105 migration", () => {
  it("drops the count-chip switch and keeps the reader's display choices", () => {
    const display = readDisplay(migrate(V104_CONFIG))

    expect("showDensityHint" in display).toBe(false)
    expect(display).toEqual({
      intensity: 0.8,
      underline: true,
      wash: false,
      minTier: "tier2",
    })
  })

  it("leaves a config without a learning-mode section alone", () => {
    const config = { uiLanguage: "en" }
    expect(migrate(config)).toEqual(config)
  })
})
