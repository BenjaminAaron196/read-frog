import type { WordBookDraft } from "./types"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"

/** Field ids the built-in Dictionary action ships with (`constants/config.ts` prefixes them). */
const DICTIONARY_FIELDS = {
  term: "default-dictionary-term",
  phonetic: "default-dictionary-phonetic",
  partOfSpeech: "default-dictionary-part-of-speech",
  definition: "default-dictionary-definition",
  context: "default-dictionary-context",
  contextTranslation: "default-dictionary-context-translation",
} as const

/**
 * Reads one output field by ID rather than by name: the schema names are
 * localized, so a UI running in Chinese would otherwise lose the mapping.
 * Numbers are stringified — a note suggested for a custom action may score or
 * count something.
 */
function readField(
  action: SelectionToolbarCustomAction,
  result: Record<string, unknown>,
  fieldId: string,
): string {
  const fieldName = action.outputSchema.find((field) => field.id === fieldId)?.name
  return readValue(fieldName ? result[fieldName] : undefined)
}

function readValue(value: unknown): string {
  if (typeof value === "number") {
    return String(value)
  }
  return typeof value === "string" ? value.trim() : ""
}

function readPrimaryField(action: SelectionToolbarCustomAction, result: Record<string, unknown>) {
  const primaryFieldName = action.outputSchema[0]?.name
  return primaryFieldName ? readValue(result[primaryFieldName]) : ""
}

/**
 * Everything but the headword, as `Name: value` lines. This is the fallback for
 * actions the word book knows nothing about (a note suggestion can run on any
 * custom action), so an arbitrary schema still lands as readable text.
 */
function readRemainingFieldLines(
  action: SelectionToolbarCustomAction,
  result: Record<string, unknown>,
): string[] {
  return action.outputSchema
    .slice(1)
    .map((field) => ({ name: field.name, value: readValue(result[field.name]) }))
    .filter((entry) => entry.value.length > 0)
    .map((entry) => `${entry.name}: ${entry.value}`)
}

export interface WordBookCaptureInput {
  action: SelectionToolbarCustomAction
  result: Record<string, unknown>
  selectionText: string
  contextText: string
  sourceTitle: string
  sourceUrl: string
}

/**
 * Turns one rendered result - a dictionary lookup, or a single suggestion from
 * a note - into the entry the word book stores: the headword, a definition
 * carrying the part of speech and the phonetic, and the sentence it came from
 * (with its translation when the model produced one). Falls back to the raw
 * selection and paragraph whenever a field is missing, so a custom action that
 * drops a field still captures something useful.
 */
export function buildWordBookDraft(input: WordBookCaptureInput): WordBookDraft {
  const { action, result, selectionText, contextText, sourceTitle, sourceUrl } = input

  const word =
    readField(action, result, DICTIONARY_FIELDS.term) ||
    readPrimaryField(action, result) ||
    selectionText.trim()

  const partOfSpeech = readField(action, result, DICTIONARY_FIELDS.partOfSpeech)
  const phonetic = readField(action, result, DICTIONARY_FIELDS.phonetic)
  const definition = readField(action, result, DICTIONARY_FIELDS.definition)

  const headline =
    [partOfSpeech ? `${partOfSpeech}.` : "", definition].filter(Boolean).join(" ") ||
    readRemainingFieldLines(action, result).join("\n") ||
    selectionText.trim()

  const definitionLines = [
    headline,
    phonetic ? `/${phonetic.replace(/^\/|\/$/g, "")}/` : "",
  ].filter(Boolean)

  const sentence = readField(action, result, DICTIONARY_FIELDS.context)
  const sentenceTranslation = readField(action, result, DICTIONARY_FIELDS.contextTranslation)
  const contextLines = [sentence || contextText.trim(), sentenceTranslation].filter(Boolean)

  return {
    word,
    definition: definitionLines.join("\n"),
    context: contextLines.join("\n"),
    sourceTitle,
    sourceUrl,
  }
}
