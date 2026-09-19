/**
 * Migration script from v101 to v102.
 *
 * Adds the `wordBook` settings section: the enabled switch plus the Notion
 * connection (integration token, target database, and the field mapping the
 * options page fills in). The saved words themselves live in IndexedDB, so this
 * step moves no user data and cannot fail on a large list.
 *
 * `wordBookConfigSchema` carries a `.default()`, which covers a UI context that
 * loads before the background migration runs, but the explicit step is still
 * required: `migrateConfig` only reaches for schema defaults on whole sections,
 * and leaving it to chance would let a stored v101 config fail `configSchema`
 * outright and be replaced by DEFAULT_CONFIG — losing the user's providers.
 *
 * Idempotent: the section is only added when absent, so running this twice is a
 * no-op.
 *
 * IMPORTANT: This is a frozen snapshot. All values are deliberately inline and
 * it imports nothing from the evolving application code, so that a later change
 * to the word-book defaults cannot retroactively change what this migration did.
 */
export function migrate(oldConfig: any): any {
  if (oldConfig === null || typeof oldConfig !== "object" || Array.isArray(oldConfig)) {
    return oldConfig
  }

  const newConfig = { ...oldConfig }

  if (!("wordBook" in newConfig)) {
    newConfig.wordBook = {
      enabled: true,
      notion: {
        apiKey: "",
        databaseId: "",
        databaseName: "",
        mappings: [],
      },
    }
  }

  return newConfig
}
