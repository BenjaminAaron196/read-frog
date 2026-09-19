import { z } from "zod"
import { DEFAULT_WORD_BOOK_CONFIG } from "@/utils/constants/word-book"

/**
 * How one word-book field is written into the user's Notion database. The
 * property id is optional because a mapping survives a rename of the property
 * as long as its name still resolves.
 */
export const notionFieldMappingSchema = z.object({
  localFieldId: z.string(),
  notionPropertyId: z.string().optional(),
  notionPropertyName: z.string(),
  notionPropertyType: z.string(),
})

export const wordBookNotionSchema = z.object({
  /**
   * The Notion integration token, deliberately named `apiKey`: the config
   * export/backup strips fields with exactly that name (`utils/config/api.ts`),
   * and any other name would leak the credential into a shared config file.
   */
  apiKey: z.string(),
  databaseId: z.string(),
  databaseName: z.string(),
  mappings: z.array(notionFieldMappingSchema),
})

/**
 * Only the SETTINGS live in config; the saved words themselves live in Dexie
 * (`utils/db/dexie/tables/word-book.ts`), because the whole config is one
 * storage key that gets re-parsed on every unrelated settings read.
 *
 * `.default()` mirrors `glossaryConfigSchema`: a config stored before this
 * section existed still parses in UI contexts that load ahead of the background
 * migration, instead of falling back to DEFAULT_CONFIG and overwriting the
 * user's providers.
 */
export const wordBookConfigSchema = z
  .object({
    enabled: z.boolean(),
    notion: wordBookNotionSchema,
  })
  .default(DEFAULT_WORD_BOOK_CONFIG)

export type WordBookConfig = z.infer<typeof wordBookConfigSchema>
export type WordBookNotionConfig = z.infer<typeof wordBookNotionSchema>
export type NotionFieldMappingConfig = z.infer<typeof notionFieldMappingSchema>
