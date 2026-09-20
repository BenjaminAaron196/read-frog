/**
 * Migration script from v104 to v105.
 *
 * Drops `learningMode.display.showDensityHint`. The learning mode used to write
 * a "N words on this page" chip into the article; the chip is gone, so the
 * switch that controlled it has no meaning and is removed from the config.
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
    return newConfig
  }

  const section: Record<string, unknown> = { ...(learningMode as Record<string, unknown>) }
  const display = section.display

  if (display !== null && typeof display === "object" && !Array.isArray(display)) {
    const displayRecord: Record<string, unknown> = { ...(display as Record<string, unknown>) }
    delete displayRecord.showDensityHint
    section.display = displayRecord
  }

  newConfig.learningMode = section
  return newConfig
}
