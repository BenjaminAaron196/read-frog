import { describe, expect, it } from "vitest"
import { TRANSLATE_STYLE_IDS } from "@/utils/constants/translate-style-prompts"
import { SMART_TRANSLATE_PROMPT_ID } from "@/utils/translate/style-router"
import { subtitleCustomPromptsConfigSchema } from "../subtitles"
import { pageCustomPromptsConfigSchema } from "../translate"

/**
 * A stored selection the schema rejects is a selection the picker cannot make:
 * the write fails validation and the control springs back to its previous value,
 * which is exactly how "smart" behaved before the ids were allowed.
 */
describe("selectable prompt ids", () => {
  it("accepts smart and every genre style for page translation", () => {
    for (const promptId of [SMART_TRANSLATE_PROMPT_ID, ...TRANSLATE_STYLE_IDS]) {
      const parsed = pageCustomPromptsConfigSchema.safeParse({ promptId, patterns: [] })
      expect(parsed.success, `${promptId} must be storable`).toBe(true)
    }
  })

  it("accepts them for subtitles too", () => {
    for (const promptId of [SMART_TRANSLATE_PROMPT_ID, ...TRANSLATE_STYLE_IDS]) {
      expect(subtitleCustomPromptsConfigSchema.safeParse({ promptId, patterns: [] }).success).toBe(
        true,
      )
    }
  })

  it("still rejects an id nothing can resolve", () => {
    expect(
      pageCustomPromptsConfigSchema.safeParse({ promptId: "not-a-prompt", patterns: [] }).success,
    ).toBe(false)
  })
})
