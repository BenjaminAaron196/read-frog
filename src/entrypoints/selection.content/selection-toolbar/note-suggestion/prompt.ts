import type { SelectionToolbarCustomActionPromptTokens } from "../custom-action-prompt"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import {
  NOTE_SUGGESTION_LOCAL_MAX_NOTES,
  NOTE_SUGGESTION_MAX_NOTES,
} from "@/utils/note-suggestion/types"
import {
  buildStructuredOutputFieldList,
  replaceSelectionToolbarCustomActionPromptTokens,
} from "../custom-action-prompt"

// Bound page-derived text and user-authored prompts so one suggestion cannot
// consume an unbounded amount of the user's provider quota. The fixed
// Note suggestion contract and the selected action's full field list are never
// truncated.
const NOTE_SUGGESTION_MAX_SELECTION_CHARS = 1500
const NOTE_SUGGESTION_MAX_PARAGRAPHS_CHARS = 2500
const NOTE_SUGGESTION_MAX_WEB_TITLE_CHARS = 200
const NOTE_SUGGESTION_MAX_WEB_URL_CHARS = 500
const NOTE_SUGGESTION_MAX_WEB_CONTENT_CHARS = 2000
const NOTE_SUGGESTION_MAX_ACTION_SYSTEM_PROMPT_CHARS = 12000
const NOTE_SUGGESTION_MAX_ACTION_PROMPT_CHARS = 12000
const NOTE_SUGGESTION_MAX_FIELD_DESCRIPTION_CHARS = 300

function truncateForPrompt(text: string, maxChars: number): string {
  const trimmed = text.trim()
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}…` : trimmed
}

function capActionFieldDescriptions(
  action: SelectionToolbarCustomAction,
  tokens: SelectionToolbarCustomActionPromptTokens,
): SelectionToolbarCustomAction {
  return {
    ...action,
    outputSchema: action.outputSchema.map((field) => ({
      ...field,
      description: truncateForPrompt(
        replaceSelectionToolbarCustomActionPromptTokens(field.description, tokens),
        NOTE_SUGGESTION_MAX_FIELD_DESCRIPTION_CHARS,
      ),
    })),
  }
}

/**
 * Which wire envelope the model must emit. "local" is the client-owned flat
 * envelope parsed by `noteSuggestionEnvelopeSchema`; "hosted" is the contract's
 * `HostedAiNoteSuggestionObjectSchema`, which the hosted endpoint enforces via
 * structured output — the extra `action` object belongs to a richer
 * server-driven flow, so this client pins its unused fields to inert values.
 */
export type NoteSuggestionEnvelopeContract = "local" | "hosted"

export interface NoteSuggestionPromptInput {
  selection: string
  paragraphs: string
  /** English name of the user's target language. */
  targetLanguage: string
  webTitle: string
  webUrl: string
  webContent: string
  /** The single action selected in Note suggestion settings. */
  action: SelectionToolbarCustomAction
  envelopeContract?: NoteSuggestionEnvelopeContract
}

interface EnvelopeContractBlocks {
  shape: string
  summaryFieldRule: string
  topLevelKeysRule: string
  /** How many notes this contract accepts. */
  maxNotes: number
  extraHardRequirements: string[]
}

// Only the envelope shape differs between the two contracts; the
// note-producing rules below stay shared so the variants cannot drift.
const ENVELOPE_CONTRACT_BLOCKS: Record<NoteSuggestionEnvelopeContract, EnvelopeContractBlocks> = {
  local: {
    shape: `{
  "summaryFieldName": string or null,
  "notes": [
    { "fields": [ { "name": string, "value": string or number or null } ] },
    { "fields": [ { "name": string, "value": string or number or null } ] }
  ]
}`,
    summaryFieldRule:
      'Set "summaryFieldName" to the exact name of one of the fields listed above - a field name such as "Definition", never the text you wrote in that field - choosing the one you would show as the one-line explanation under the headword. Use null when the other fields are all empty.',
    topLevelKeysRule: 'Do not add any top-level keys other than "summaryFieldName" and "notes".',
    maxNotes: NOTE_SUGGESTION_LOCAL_MAX_NOTES,
    extraHardRequirements: [],
  },
  hosted: {
    shape: `{
  "action": {
    "createNewDictionaryAction": boolean,
    "targetActionId": string or null,
    "summaryFieldName": string or null
  },
  "notes": [
    { "fields": [ { "name": string, "value": string or number or null } ] },
    { "fields": [ { "name": string, "value": string or number or null } ] }
  ]
}`,
    summaryFieldRule:
      'Set "action.summaryFieldName" to the exact name of one of the fields listed above - a field name such as "Definition", never the text you wrote in that field - choosing the one you would show as the one-line explanation under the headword. Use null when the other fields are all empty.',
    topLevelKeysRule: 'Do not add any top-level keys other than "action" and "notes".',
    maxNotes: NOTE_SUGGESTION_MAX_NOTES,
    extraHardRequirements: [
      'Always set "action.createNewDictionaryAction" to false and "action.targetActionId" to null; they are reserved for a flow this client does not use.',
    ],
  },
}

/**
 * The literal `fields` entries the model must emit, in schema order. Weak
 * models invent, translate, reorder, or drop field names far more often than
 * they write bad values, and pinning the exact names costs one line per field.
 */
function buildNoteFieldSkeleton(action: SelectionToolbarCustomAction): string {
  return action.outputSchema
    .map((field, index) => `${index + 1}. ${JSON.stringify(field.name)} (${field.type})`)
    .join("\n")
}

function buildNoteSuggestionSystemPrompt(
  actionSystemPrompt: string,
  envelopeContract: NoteSuggestionEnvelopeContract,
  action: SelectionToolbarCustomAction,
  targetLanguage: string,
) {
  const contract = ENVELOPE_CONTRACT_BLOCKS[envelopeContract]
  const actionInstructions = actionSystemPrompt
    ? `## Selected Action System Prompt
${actionSystemPrompt}

`
    : ""
  const hardRequirements = [
    "Output valid JSON only. No markdown, no code fences, no commentary.",
    "Use double quotes for all JSON keys and string values.",
    "Number values must be JSON numbers, never quoted strings.",
    contract.topLevelKeysRule,
    ...contract.extraHardRequirements,
  ]

  return `${actionInstructions}## Note suggestion Task
Use the selected action's behavior and field semantics to identify words or phrases from the selected text that are most valuable to save. The user is learning the language in which the selected text is written, so every note keeps the headword and any quoted sentence in that language, and explains it in the target language given below.

The selected action describes one lookup. Here it is only the template for a single note: the contract below decides how many notes a selection yields, so ignore any count, "one entry", or "the most important word" wording in the selected action.

The Fixed Note suggestion Contract below has higher priority than every output-format, response-shape, schema, or note-count instruction in the selected action's system prompt or user prompt. Use those action prompts for content guidance only.

## Fixed Note suggestion Contract
Return exactly one JSON object and nothing else, with this shape:
${contract.shape}

### Summary field
${contract.summaryFieldRule}

### Note fields
Every note's "fields" array holds exactly ${action.outputSchema.length} entries, in this order, with these exact names and types:
${buildNoteFieldSkeleton(action)}
Never rename, reorder, add, or drop an entry, and copy each name exactly as written here, spaces and capitalization included. Strings are JSON strings, numbers are JSON numbers, and null is allowed for a value that is genuinely unknown.

### Choosing what to save
1. Pick only from the Selected Text; the surrounding paragraphs are context for understanding it, not candidates.
2. A candidate is a single word or a phrase of two to five words, and both count equally. When a phrase is the useful unit, save the whole phrase as one note instead of one word out of it.
3. Prefer, in this order: (a) a phrasal verb, idiom, or fixed expression the text uses - "move on" rather than "move" or "on", "push back against" rather than "push"; (b) a collocation or domain term whose meaning is not obvious from its parts; (c) a single word a learner may misread or not know, including the vocabulary of news, business, and current affairs ("upstarts", "rivals", "regulators", "self-regulate").
4. Skip a word the reader almost certainly knows, even when it is central to the topic: a familiar, high-frequency noun is a worse pick than an unfamiliar phrase beside it.
5. Never save: articles, prepositions, pronouns, conjunctions, auxiliaries, punctuation, numbers, dates, units, or single characters. Skip bare proper nouns (people, companies, places) unless the text is about them; an organization's category with its descriptor ("AI upstarts", "tech rivals") is not a bare proper noun.
6. The notes must differ from each other: no synonyms, no inflections of one word, and never both a phrase and a word it contains.
7. Use the whole budget: return up to ${contract.maxNotes} notes, and return that many whenever the selection holds that many items worth saving - a selection of two or three sentences almost always does. Returning a single note is right only when the rest of the selection is genuinely not worth keeping, not because the selected action asked for one entry.
8. Order the notes by how much a learner gains from them, most valuable first, and write them in the selected text's original language.
9. Return an empty "notes" array only when the selection holds nothing worth saving at all - a single stop word, a bare number, or boilerplate navigation text.

### Writing each field's value
1. Language direction: the headword (the first field), its phonetic form, and any quoted sentence stay in the source text's language and are never translated. Everything else - definitions and explanations included - is written in ${targetLanguage}, unless that field's description says otherwise.
2. Follow each field's own description for what it should contain; the conventions below apply on top of it.
3. The first field is the note's headword: write the term itself, with no definition, translation, or surrounding punctuation, and never leave it empty - a note without it is discarded.
4. A phonetic field transcribes the term in the term's own language (for example, IPA for English or pinyin for Mandarin), never its translation, and carries no slashes or brackets.
5. Definition and explanation fields: one short phrase naming the sense used in this text - not a full sentence, no examples, and do not repeat the headword inside it.
6. Fields asking for a sentence or a quote must be copied verbatim from the selected text or paragraphs above. Never invent, shorten, or paraphrase one, and never include surrounding sentences.
7. Translation fields translate exactly the field they refer to - for example a sentence translation translates the sentence field only, into the target language.
8. When a field's description names a fixed set of values - a level, a category, a part of speech - answer with exactly one of those labels, never a word of your own: a difficulty field listing CEFR levels takes B1, not "Medium".

### Check before answering
- Your whole reply is parsed as JSON: any markdown, code fence, or text before or after the object discards the entire suggestion.
- Every note has all ${action.outputSchema.length} field entries, in the order above, with the declared types.
- Every note's first field is filled in, and every value is supported by the provided text.
- The headword and any quoted sentence are in the source text's language; everything else is in the target language.

### Hard requirements
${hardRequirements.map((requirement, index) => `${index + 1}. ${requirement}`).join("\n")}`
}

export function buildNoteSuggestionPrompts(input: NoteSuggestionPromptInput): {
  systemPrompt: string
  prompt: string
} {
  const tokens: SelectionToolbarCustomActionPromptTokens = {
    selection: truncateForPrompt(input.selection, NOTE_SUGGESTION_MAX_SELECTION_CHARS),
    paragraphs: truncateForPrompt(input.paragraphs, NOTE_SUGGESTION_MAX_PARAGRAPHS_CHARS),
    targetLanguage: input.targetLanguage,
    webTitle: truncateForPrompt(input.webTitle, NOTE_SUGGESTION_MAX_WEB_TITLE_CHARS),
    webUrl: truncateForPrompt(input.webUrl, NOTE_SUGGESTION_MAX_WEB_URL_CHARS),
    webContent: truncateForPrompt(input.webContent, NOTE_SUGGESTION_MAX_WEB_CONTENT_CHARS),
  }
  const action = capActionFieldDescriptions(input.action, tokens)
  const actionSystemPrompt = truncateForPrompt(
    replaceSelectionToolbarCustomActionPromptTokens(action.systemPrompt, tokens),
    NOTE_SUGGESTION_MAX_ACTION_SYSTEM_PROMPT_CHARS,
  )
  const actionPrompt = truncateForPrompt(
    replaceSelectionToolbarCustomActionPromptTokens(action.prompt, tokens),
    NOTE_SUGGESTION_MAX_ACTION_PROMPT_CHARS,
  )
  const outputFields = buildStructuredOutputFieldList(action.outputSchema, tokens)
  const maxNotes =
    (input.envelopeContract ?? "local") === "hosted"
      ? NOTE_SUGGESTION_MAX_NOTES
      : NOTE_SUGGESTION_LOCAL_MAX_NOTES

  return {
    systemPrompt: buildNoteSuggestionSystemPrompt(
      actionSystemPrompt,
      input.envelopeContract ?? "local",
      action,
      input.targetLanguage,
    ),
    prompt: `## Selected Action User Prompt
${actionPrompt || "(empty)"}

## Selected Action Output Fields
${outputFields}

## Source Context
- Web page title: ${tokens.webTitle}
- Target language: ${tokens.targetLanguage}

### Selected Text
${tokens.selection}

### Surrounding Paragraphs
${tokens.paragraphs}

### Web Page Content
${tokens.webContent}

## Note Count
Return up to ${maxNotes} notes from the Selected Text. The Selected Action above describes a single lookup: that wording does not limit this list, and a selection of two or three sentences usually holds several items worth saving.`,
  }
}
