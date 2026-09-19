import { describe, expect, it } from "vitest"
import { migrate } from "../../migration-scripts/v101-to-v102"

/** A stored v101 config, typed like the migration it feeds. */
function configFromV101(): any {
  return {
    uiLanguage: "zh-CN",
    language: { sourceCode: "auto", targetCode: "cmn", level: "intermediate" },
    providersConfig: [{ id: "openai", apiKey: "sk-123" }],
    glossary: { enabled: true },
    siteRules: { userRules: [], disabledBuiltInRules: [] },
  }
}

describe("v101 to v102 migration", () => {
  it("adds an empty Notion connection and keeps the rest of the config", () => {
    const migrated = migrate(configFromV101())

    expect(migrated.wordBook).toEqual({
      enabled: true,
      notion: { apiKey: "", databaseId: "", databaseName: "", mappings: [] },
    })
    expect(migrated.providersConfig).toEqual([{ id: "openai", apiKey: "sk-123" }])
    expect(migrated.language.targetCode).toBe("cmn")
  })

  it("keeps a word book the user already configured", () => {
    const existing = {
      enabled: false,
      notion: {
        apiKey: "secret_x",
        databaseId: "db-1",
        databaseName: "Words",
        mappings: [
          {
            localFieldId: "word",
            notionPropertyName: "Word",
            notionPropertyType: "title",
          },
        ],
      },
    }

    const migrated = migrate({ ...configFromV101(), wordBook: existing })

    expect(migrated.wordBook).toEqual(existing)
  })

  it("is idempotent and tolerates configs that are not objects", () => {
    const once = migrate(configFromV101())
    expect(migrate(once)).toEqual(once)

    expect(migrate(null)).toBeNull()
    expect(migrate("nonsense")).toBe("nonsense")
    expect(migrate([1, 2])).toEqual([1, 2])
  })
})
