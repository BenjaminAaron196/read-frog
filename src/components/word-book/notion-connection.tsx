import type { NotionFieldMapping } from "@/utils/notion/fields"
import type { NotionDatabase, NotionDatabaseSummary } from "@/utils/notion/types"
import { useAtom } from "jotai"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { Input } from "@/components/ui/base-ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { toastManager } from "@/components/ui/base-ui/toast"
import { ConfigItem } from "@/entrypoints/options/components/config-item"
import { ConfigSection } from "@/entrypoints/options/components/config-section"
import { SELECT_CONTENT_PROPS } from "@/entrypoints/options/components/select-content-props"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { isSupportedWordBookPropertyType, WORD_BOOK_FIELDS } from "@/utils/notion/fields"

/** The Notion title property is the only one that can hold the headword. */
function buildDefaultMappings(database: NotionDatabase): NotionFieldMapping[] {
  const title = Object.values(database.properties).find((property) => property.type === "title")
  if (!title) {
    return []
  }

  return [
    {
      localFieldId: "word",
      notionPropertyId: title.id,
      notionPropertyName: title.name,
      notionPropertyType: title.type,
    },
  ]
}

export function NotionConnection({ showHeading = true }: { showHeading?: boolean } = {}) {
  const [wordBook, setWordBook] = useAtom(configFieldsAtomMap.wordBook)
  const notion = wordBook.notion

  const [token, setToken] = useState(notion.apiKey)
  const [database, setDatabase] = useState<NotionDatabase | null>(null)
  const [databases, setDatabases] = useState<NotionDatabaseSummary[]>([])
  const [mappings, setMappings] = useState<NotionFieldMapping[]>(notion.mappings)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadDatabase = async (apiKey: string, databaseId: string, autoMap: boolean) => {
    const result = await sendMessage("notionGetDatabase", { apiKey, databaseId })
    if (!result.ok) {
      setStatus(i18n.t("wordBook.notion.testFailed", [result.message]))
      return null
    }

    setDatabase(result.data)
    setDatabases((current) =>
      current.some((entry) => entry.id === result.data.id)
        ? current
        : [...current, { id: result.data.id, title: result.data.title }],
    )
    if (autoMap && mappings.length === 0) {
      setMappings(buildDefaultMappings(result.data))
    }
    return result.data
  }

  // Reopening the page has to restore the property list, otherwise the mapping
  // rows would have nothing to select from.
  useEffect(() => {
    if (!notion.apiKey || !notion.databaseId) {
      return
    }
    void loadDatabase(notion.apiKey, notion.databaseId, false)
    // eslint-disable-next-line react/exhaustive-deps -- restore once per stored connection
  }, [])

  const handleTest = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const result = await sendMessage("notionTestConnection", { apiKey: token.trim() })
      if (!result.ok) {
        setStatus(i18n.t("wordBook.notion.testFailed", [result.message]))
        return
      }

      setStatus(i18n.t("wordBook.notion.testOk", [result.data.name ?? ""]))
      const list = await sendMessage("notionListDatabases", { apiKey: token.trim() })
      if (list.ok) {
        setDatabases(list.data)
        if (list.data.length === 0) {
          setStatus(i18n.t("wordBook.notion.noDatabases"))
        }
      }
    } finally {
      setBusy(false)
    }
  }

  const handlePickDatabase = async (databaseId: string) => {
    if (!databaseId) {
      return
    }

    setBusy(true)
    try {
      await loadDatabase(token.trim(), databaseId, true)
    } finally {
      setBusy(false)
    }
  }

  const handleMappingChange = (localFieldId: string, propertyName: string) => {
    setMappings((current) => {
      const rest = current.filter((mapping) => mapping.localFieldId !== localFieldId)
      if (!propertyName || !database) {
        return rest
      }

      const property = Object.values(database.properties).find(
        (entry) => entry.name === propertyName,
      )
      if (!property) {
        return rest
      }

      return [
        ...rest,
        {
          localFieldId,
          notionPropertyId: property.id,
          notionPropertyName: property.name,
          notionPropertyType: property.type,
        },
      ]
    })
  }

  const handleSave = async () => {
    await setWordBook({
      ...wordBook,
      notion: {
        apiKey: token.trim(),
        databaseId: database?.id ?? notion.databaseId,
        databaseName: database?.title ?? notion.databaseName,
        mappings,
      },
    })
    toastManager.add({ type: "success", title: i18n.t("wordBook.notion.saved") })
  }

  const hasTitleMapping = mappings.some((mapping) => mapping.notionPropertyType === "title")

  return (
    <ConfigSection hideTitle={!showHeading} title={i18n.t("wordBook.notion.title")}>
      <ConfigItem
        title={i18n.t("wordBook.notion.token")}
        description={i18n.t("wordBook.notion.description")}
      >
        <div className="flex items-center gap-2">
          <Input
            className="w-64"
            placeholder={i18n.t("wordBook.notion.tokenPlaceholder")}
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button
            disabled={busy || !token.trim()}
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => void handleTest()}
          >
            {busy ? i18n.t("wordBook.notion.testing") : i18n.t("wordBook.notion.test")}
          </Button>
        </div>
      </ConfigItem>

      {status && <p className="text-sm text-muted-foreground">{status}</p>}

      <ConfigItem title={i18n.t("wordBook.notion.database")}>
        <Select
          value={database?.id ?? notion.databaseId}
          onValueChange={(value: string | null) => void handlePickDatabase(value ?? "")}
        >
          <SelectTrigger className="w-64">
            <SelectValue render={<span />}>
              {database?.title || notion.databaseName || i18n.t("wordBook.notion.loadDatabases")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent {...SELECT_CONTENT_PROPS}>
            <SelectGroup>
              {databases.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.title}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </ConfigItem>

      {database && (
        <ConfigSection contentClassName="gap-4" title={i18n.t("wordBook.notion.mapping")}>
          {WORD_BOOK_FIELDS.map((field) => {
            const options = Object.values(database.properties).filter((property) =>
              isSupportedWordBookPropertyType(field.id, property.type),
            )
            const current = mappings.find((mapping) => mapping.localFieldId === field.id)

            return (
              <ConfigItem key={field.id} title={i18n.t(`wordBook.field.${field.id}`)}>
                <Select
                  value={current?.notionPropertyName ?? ""}
                  onValueChange={(value: string | null) =>
                    handleMappingChange(field.id, value ?? "")
                  }
                >
                  <SelectTrigger className="w-64">
                    <SelectValue render={<span />}>
                      {current?.notionPropertyName ?? i18n.t("wordBook.notion.ignore")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent {...SELECT_CONTENT_PROPS}>
                    <SelectGroup>
                      <SelectItem value="">{i18n.t("wordBook.notion.ignore")}</SelectItem>
                      {options.map((property) => (
                        <SelectItem key={property.id} value={property.name}>
                          {property.name}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </ConfigItem>
            )
          })}

          {!hasTitleMapping && (
            <p className="text-sm text-destructive">
              {i18n.t("wordBook.notion.mappingIncomplete")}
            </p>
          )}
        </ConfigSection>
      )}

      <div>
        <Button
          disabled={busy || !token.trim() || (!!database && !hasTitleMapping)}
          type="button"
          onClick={() => void handleSave()}
        >
          {i18n.t("wordBook.notion.save")}
        </Button>
      </div>
    </ConfigSection>
  )
}
