/**
 * Migration script from v103 to v104.
 *
 * Adds the three learning-mode fields that arrived after the section itself:
 * the word card's AI switch and per-page request cap, the `minTier` display
 * quiet mode for vocabulary-dense pages, and the dictionary source list the
 * one-click download reads.
 *
 * Each field is added only when missing, so a config that already carries them
 * keeps its values and running this twice is a no-op.
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
  const learningMode = newConfig.learningMode

  if (learningMode === null || typeof learningMode !== "object" || Array.isArray(learningMode)) {
    // No section at all: v103's own migration will build it on the way here, so
    // nothing to patch.
    return newConfig
  }

  const section: Record<string, unknown> = { ...(learningMode as Record<string, unknown>) }

  if (!("ai" in section)) {
    section.ai = { enabled: true, maxRequestsPerPage: 20 }
  }

  if (!("dictionarySources" in section)) {
    section.dictionarySources = []
  }

  const display = section.display
  if (display !== null && typeof display === "object" && !Array.isArray(display)) {
    const displayRecord: Record<string, unknown> = { ...(display as Record<string, unknown>) }
    if (!("minTier" in displayRecord)) {
      displayRecord.minTier = "all"
    }
    section.display = displayRecord
  }

  newConfig.learningMode = section
  return newConfig
}
