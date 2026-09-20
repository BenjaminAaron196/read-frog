/**
 * Migration script from v102 to v103.
 *
 * Adds the `learningMode` settings section: the feature switch, the difficulty
 * profile, the display controls and the per-site exclusions. The dictionary the
 * marks are judged against is not config — it is a multi-megabyte artifact under
 * its own `chrome.storage.local` keys — so this step moves no user data and
 * cannot fail on a large import.
 *
 * `learningModeConfigSchema` carries a `.default()`, which covers a UI context
 * that loads before the background migration runs, but the explicit step is still
 * required: `migrateConfig` only reaches for schema defaults on whole sections,
 * and leaving it to chance would let a stored v102 config fail `configSchema`
 * outright and be replaced by DEFAULT_CONFIG — losing the user's providers.
 *
 * Idempotent: the section is only added when absent, so running this twice is a
 * no-op.
 *
 * IMPORTANT: This is a frozen snapshot. All values are deliberately inline and
 * it imports nothing from the evolving application code, so that a later change
 * to the learning-mode defaults cannot retroactively change what this migration
 * did.
 */
export function migrate(oldConfig: unknown): unknown {
  if (oldConfig === null || typeof oldConfig !== "object" || Array.isArray(oldConfig)) {
    return oldConfig
  }

  const newConfig: Record<string, unknown> = { ...oldConfig }

  if (!("learningMode" in newConfig)) {
    newConfig.learningMode = {
      enabled: false,
      profile: {
        kind: "cefr",
        exam: "cet6",
        cefrLevel: "B1",
        vocabSize: 8000,
      },
      display: {
        showDensityHint: true,
        intensity: 1,
        underline: true,
        wash: true,
      },
      excludedPatterns: [],
      maxHighlightsPerPage: 4000,
    }
  }

  return newConfig
}
