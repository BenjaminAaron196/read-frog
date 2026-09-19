import type { WordBookRecord } from "@/utils/word-book/types"

/**
 * The local fields a word book entry exposes, and the Notion property types
 * each one can be written into. The options page offers these as the left side
 * of the field mapping.
 */
export const WORD_BOOK_FIELDS = [
  { id: "word", supportedTypes: ["title", "rich_text"] },
  { id: "definition", supportedTypes: ["rich_text"] },
  { id: "context", supportedTypes: ["rich_text"] },
  { id: "sourceUrl", supportedTypes: ["url", "rich_text"] },
  { id: "sourceTitle", supportedTypes: ["rich_text"] },
  { id: "addedAt", supportedTypes: ["date", "rich_text"] },
] as const

export type WordBookFieldId = (typeof WORD_BOOK_FIELDS)[number]["id"]

export interface NotionFieldMapping {
  /** A `WordBookFieldId`; typed loosely because the value comes from stored config. */
  localFieldId: string
  notionPropertyId?: string
  notionPropertyName: string
  notionPropertyType: string
}

export function getWordBookField(fieldId: string) {
  return WORD_BOOK_FIELDS.find((field) => field.id === fieldId)
}

/**
 * How to find an entry that is already in the database: the mapped `word`
 * property, when Notion can filter on it (a title or rich-text column).
 * Null means "cannot tell", which is the safe answer - the caller then creates
 * the page rather than silently dropping a word.
 */
export function buildWordLookup(
  record: { word: string },
  mappings: NotionFieldMapping[],
): { propertyName: string; propertyType: "title" | "rich_text"; value: string } | null {
  const mapping = mappings.find((entry) => entry.localFieldId === "word")
  const value = record.word.trim()
  if (!mapping || !value) {
    return null
  }
  if (mapping.notionPropertyType !== "title" && mapping.notionPropertyType !== "rich_text") {
    return null
  }

  return {
    propertyName: mapping.notionPropertyName,
    propertyType: mapping.notionPropertyType,
    value,
  }
}

export function isSupportedWordBookPropertyType(fieldId: string, notionType: string): boolean {
  const field = getWordBookField(fieldId)
  return !!field && (field.supportedTypes as readonly string[]).includes(notionType)
}

function readFieldValue(record: WordBookRecord, fieldId: WordBookFieldId): string {
  switch (fieldId) {
    case "word":
      return record.word
    case "definition":
      return record.definition
    case "context":
      return record.context
    case "sourceUrl":
      return record.sourceUrl
    case "sourceTitle":
      return record.sourceTitle
    case "addedAt":
      return new Date(record.addedAt).toISOString()
    default:
      return ""
  }
}

function toNotionPropertyValue(
  fieldId: WordBookFieldId,
  notionType: string,
  value: string,
): unknown {
  switch (notionType) {
    case "title":
      return { title: [{ type: "text", text: { content: value } }] }
    case "rich_text":
      return { rich_text: [{ type: "text", text: { content: value } }] }
    case "url":
      return { url: value || null }
    case "date":
      return { date: value ? { start: value } : null }
    case "number":
      // Only the timestamp is numeric; everything else would lose meaning.
      return fieldId === "addedAt" ? { number: new Date(value).getTime() } : null
    default:
      return null
  }
}

/**
 * Turns one record into the `properties` payload of `POST /v1/pages`. Fields
 * whose Notion property type cannot carry them (a relation, a formula) are
 * dropped rather than failing the whole write: the entry still lands, and the
 * options page keeps the property out of the mapping in the first place.
 */
export function buildNotionPageProperties(
  record: WordBookRecord,
  mappings: NotionFieldMapping[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {}

  for (const mapping of mappings) {
    const field = getWordBookField(mapping.localFieldId)
    if (!field || !mapping.notionPropertyName) {
      continue
    }

    const value = readFieldValue(record, field.id)
    if (!value) {
      continue
    }

    const built = toNotionPropertyValue(field.id, mapping.notionPropertyType, value)
    if (built !== null) {
      properties[mapping.notionPropertyName] = built
    }
  }

  return properties
}

/** Notion rejects a page without a title, so the mapping must carry one. */
export function hasTitleMapping(
  mappings: NotionFieldMapping[],
  properties: Record<string, { type: string }>,
): boolean {
  return mappings.some((mapping) => {
    const property = properties[mapping.notionPropertyName]
    return property?.type === "title" && !!mapping.notionPropertyName
  })
}
