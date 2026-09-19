/**
 * The word book works locally with no setup; the Notion half stays idle until
 * the user pastes an integration token and picks a database, so the entry stays
 * enabled with an empty connection rather than hiding the feature.
 *
 * Deliberately untyped: annotating this with the schema's own type would make
 * the schema and its default reference each other.
 */
export const DEFAULT_WORD_BOOK_CONFIG = {
  enabled: true,
  notion: {
    apiKey: "",
    databaseId: "",
    databaseName: "",
    mappings: [] as Array<{
      localFieldId: string
      notionPropertyId?: string
      notionPropertyName: string
      notionPropertyType: string
    }>,
  },
}
