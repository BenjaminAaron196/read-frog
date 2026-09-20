import { describe, expect, it, vi } from "vitest"
/** The genre styles ship as built-ins: same list, nine more names. */
const STYLE_IDS = [
  "smart",
  "news",
  "gaming",
  "tech-docs",
  "academic",
  "social",
  "ecommerce",
  "fiction",
  "spoken",
] as const

/** The i18n key each id names, since the mock resolves unknown keys to the key. */
const STYLE_KEY: Record<(typeof STYLE_IDS)[number], string> = {
  smart: "smart",
  news: "news",
  gaming: "gaming",
  "tech-docs": "techDocs",
  academic: "academic",
  social: "social",
  ecommerce: "ecommerce",
  fiction: "fiction",
  spoken: "spoken",
}

const STYLE_LABELS = STYLE_IDS.map(
  (id) => `options.translation.personalizedPrompts.builtInPrompts.${STYLE_KEY[id]}.name`,
)

import {
  DEFAULT_TRANSLATE_PROMPT_ID,
  PRECISION_REWRITE_TRANSLATE_PROMPT_ID,
} from "@/utils/constants/prompt"
import {
  getBuiltInPageTranslatePrompts,
  getBuiltInSubtitleTranslatePrompts,
  getPageTranslatePromptSelectItems,
} from "../built-in-prompts"

vi.mock("@/utils/i18n", () => ({
  i18n: {
    t: (key: string) =>
      ({
        "options.translation.personalizedPrompts.default": "Default",
        "options.translation.personalizedPrompts.builtInPrompts.precisionRewrite.name":
          "Deep polish",
        "options.translation.personalizedPrompts.builtInPrompts.default.description":
          "Default description",
        "options.translation.personalizedPrompts.builtInPrompts.precisionRewrite.description":
          "Precision description",
      })[key] ?? key,
  },
}))

describe("built-in translation prompt presentation", () => {
  it("orders page built-ins before custom prompts", () => {
    const items = getPageTranslatePromptSelectItems([
      { id: "custom", name: "Custom", systemPrompt: "System", prompt: "Prompt" },
    ])

    expect(items.map(({ value }) => value)).toEqual([
      DEFAULT_TRANSLATE_PROMPT_ID,
      PRECISION_REWRITE_TRANSLATE_PROMPT_ID,
      ...STYLE_IDS,
      "custom",
    ])
    expect(items.map(({ label }) => label)).toEqual([
      "Default",
      "Deep polish",
      ...STYLE_LABELS,
      "Custom",
    ])
  })

  it("offers precision rewrite only for page translation", () => {
    // The genre styles are not in either built-in registry: they are appended by
    // the picker's choice list and resolved by the builders, so the registries
    // keep describing what each surface owns.
    expect(getBuiltInPageTranslatePrompts().map(({ id }) => id)).toEqual([
      DEFAULT_TRANSLATE_PROMPT_ID,
      PRECISION_REWRITE_TRANSLATE_PROMPT_ID,
    ])
    expect(getBuiltInSubtitleTranslatePrompts().map(({ id }) => id)).toEqual([
      DEFAULT_TRANSLATE_PROMPT_ID,
    ])
  })
})
