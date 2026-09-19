import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { describe, expect, it } from "vitest"
import { buildWordBookDraft } from "../capture"

function dictionaryAction(): SelectionToolbarCustomAction {
  return {
    id: "default-dictionary",
    name: "Dictionary",
    enabled: true,
    icon: "tabler:book-2",
    providerId: "read-frog-free-ai",
    systemPrompt: "",
    prompt: "",
    outputSchema: [
      { id: "default-dictionary-term", name: "Term", type: "string" },
      { id: "default-dictionary-phonetic", name: "Phonetic", type: "string" },
      { id: "default-dictionary-part-of-speech", name: "Part of Speech", type: "string" },
      { id: "default-dictionary-definition", name: "Definition", type: "string" },
      { id: "default-dictionary-context", name: "Sentence", type: "string" },
      {
        id: "default-dictionary-context-translation",
        name: "Sentence Translation",
        type: "string",
      },
    ],
  } as SelectionToolbarCustomAction
}

const RESULT = {
  Term: "frog",
  Phonetic: "/frɒɡ/",
  "Part of Speech": "noun",
  Definition: "a small tailless amphibian",
  Sentence: "The frog jumped off the lily pad.",
  "Sentence Translation": "青蛙从睡莲叶上跳了下去。",
}

const INPUT = {
  action: dictionaryAction(),
  result: RESULT,
  selectionText: "  frog  ",
  contextText: "A paragraph that happens to contain frog.",
  sourceTitle: "Example story",
  sourceUrl: "https://example.com/story",
}

describe("word book capture", () => {
  it("builds the entry from the rendered dictionary fields", () => {
    expect(buildWordBookDraft(INPUT)).toEqual({
      word: "frog",
      definition: "noun. a small tailless amphibian\n/frɒɡ/",
      context: "The frog jumped off the lily pad.\n青蛙从睡莲叶上跳了下去。",
      sourceTitle: "Example story",
      sourceUrl: "https://example.com/story",
    })
  })

  it("falls back to the selection and the paragraph when fields are missing", () => {
    const draft = buildWordBookDraft({ ...INPUT, result: {} })

    expect(draft.word).toBe("frog")
    expect(draft.definition).toBe("frog")
    expect(draft.context).toBe("A paragraph that happens to contain frog.")
  })

  it("reads fields by id, so a localized schema cannot lose the mapping", () => {
    const action = dictionaryAction()
    action.outputSchema = action.outputSchema.map((field) => ({
      ...field,
      name: `术语-${field.id}`,
    }))
    const localizedResult = Object.fromEntries(
      Object.entries(RESULT).map(([name, value]) => {
        const field = dictionaryAction().outputSchema.find((entry) => entry.name === name)
        return [`术语-${field?.id}`, value]
      }),
    )

    expect(buildWordBookDraft({ ...INPUT, action, result: localizedResult }).word).toBe("frog")
  })
})
