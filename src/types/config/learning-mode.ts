import { z } from "zod"
import { DEFAULT_LEARNING_MODE_CONFIG } from "@/utils/constants/learning-mode"
import { CEFR_LEVELS, EXAM_TAGS } from "@/utils/learning-mode/types"

export const learningProfileSchema = z.object({
  kind: z.enum(["exam", "cefr", "vocabSize"]),
  exam: z.enum(EXAM_TAGS),
  cefrLevel: z.enum(CEFR_LEVELS),
  vocabSize: z.number().int().min(500).max(60000),
})

export const learningDisplaySchema = z.object({
  showDensityHint: z.boolean(),
  intensity: z.number().min(0.3).max(1),
  underline: z.boolean(),
  wash: z.boolean(),
})

/**
 * Learning mode settings. The dictionary itself is NOT config: it is a
 * multi-megabyte artifact stored under its own `chrome.storage.local` keys
 * (`utils/constants/learning-mode.ts`), because the config is one storage key
 * that is re-parsed on every unrelated settings read.
 *
 * `.default()` mirrors the other sections: a config stored before this section
 * existed still parses in UI contexts that load ahead of the background
 * migration, instead of falling back to DEFAULT_CONFIG and overwriting the
 * user's providers.
 */
export const learningModeConfigSchema = z
  .object({
    enabled: z.boolean(),
    profile: learningProfileSchema,
    display: learningDisplaySchema,
    excludedPatterns: z.array(z.string()),
    maxHighlightsPerPage: z.number().int().min(200).max(20000),
  })
  .default(DEFAULT_LEARNING_MODE_CONFIG)

export type LearningModeConfig = z.infer<typeof learningModeConfigSchema>
export type LearningProfileConfig = z.infer<typeof learningProfileSchema>
export type LearningDisplayConfig = z.infer<typeof learningDisplaySchema>
