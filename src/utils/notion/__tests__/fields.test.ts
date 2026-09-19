import type { WordBookRecord } from "@/utils/word-book/types"
import { describe, expect, it } from "vitest"
import {
  buildNotionPageProperties,
  hasTitleMapping,
  isSupportedWordBookPropertyType,
  type NotionFieldMapping,
  buildWordLookup,
} from "../fields"

const RECORD: WordBookRecord = {
  id: "word-1",
  word: "frog",
  definition: "a small tailless amphibian",
  context: "The frog jumped off the lily pad.",
  sourceUrl: "https://example.com/story",
  sourceTitle: "Example story",
  addedAt: Date.UTC(2026, 8, 19, 3, 0, 0),
  syncStatus: "pending",
  syncAttempts: 0,
}

function mapping(
  localFieldId: NotionFieldMapping["localFieldId"],
  notionPropertyName: string,
  notionPropertyType: string,
): NotionFieldMapping {
  return { localFieldId, notionPropertyName, notionPropertyType }
}

describe("notion field mapping", () => {
  it("builds the property payload for the mapped fields", () => {
    const properties = buildNotionPageProperties(RECORD, [
      mapping("word", "Word", "title"),
      mapping("definition", "Meaning", "rich_text"),
      mapping("sourceUrl", "Source", "url"),
      mapping("addedAt", "Added", "date"),
    ])

    expect(properties).toEqual({
      Word: { title: [{ type: "text", text: { content: "frog" } }] },
      Meaning: { rich_text: [{ type: "text", text: { content: "a small tailless amphibian" } }] },
      Source: { url: "https://example.com/story" },
      Added: { date: { start: "2026-09-19T03:00:00.000Z" } },
    })
  })

  it("drops fields the target property cannot carry and fields with no value", () => {
    const properties = buildNotionPageProperties({ ...RECORD, context: "" }, [
      mapping("word", "Word", "title"),
      // A relation cannot hold the definition; the entry still lands.
      mapping("definition", "Related", "relation"),
      mapping("context", "Context", "rich_text"),
    ])

    expect(properties).toEqual({ Word: { title: [{ type: "text", text: { content: "frog" } }] } })
  })

  it("knows which property types each field accepts", () => {
    expect(isSupportedWordBookPropertyType("word", "title")).toBe(true)
    expect(isSupportedWordBookPropertyType("word", "rich_text")).toBe(true)
    expect(isSupportedWordBookPropertyType("word", "url")).toBe(false)
    expect(isSupportedWordBookPropertyType("addedAt", "date")).toBe(true)
    expect(isSupportedWordBookPropertyType("nope", "title")).toBe(false)
  })

  it("requires a title property in the mapping, because Notion pages cannot be created without one", () => {
    const properties = {
      Word: { id: "title", name: "Word", type: "title" },
      Meaning: { id: "abc", name: "Meaning", type: "rich_text" },
    }

    expect(hasTitleMapping([mapping("word", "Word", "title")], properties)).toBe(true)
    expect(hasTitleMapping([mapping("definition", "Meaning", "rich_text")], properties)).toBe(false)
  })

  it("looks an entry up by its word only when that property can be filtered", () => {
    expect(buildWordLookup({ word: "ephemeral" }, [mapping("word", "Word", "title")])).toEqual({
      propertyName: "Word",
      propertyType: "title",
      value: "ephemeral",
    })
    expect(buildWordLookup({ word: "ephemeral" }, [mapping("word", "Word", "rich_text")])).toEqual({
      propertyName: "Word",
      propertyType: "rich_text",
      value: "ephemeral",
    })
    // A url or date column cannot be matched by equality, and a missing or
    // blank word means there is nothing to match on: create instead of skip.
    expect(buildWordLookup({ word: "ephemeral" }, [mapping("word", "Word", "url")])).toBeNull()
    expect(
      buildWordLookup({ word: "ephemeral" }, [mapping("definition", "Meaning", "rich_text")]),
    ).toBeNull()
    expect(buildWordLookup({ word: "   " }, [mapping("word", "Word", "title")])).toBeNull()
  })
})
