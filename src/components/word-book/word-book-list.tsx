import type { WordBookRecord } from "@/utils/word-book/types"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { ConfigSection } from "@/entrypoints/options/components/config-section"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"

const STATUS_KEY = {
  created: "wordBook.panel.syncStateSynced",
  pending: "wordBook.panel.syncStatePending",
  failed: "wordBook.panel.syncStateFailed",
} as const

function statusClassName(record: WordBookRecord): string {
  if (record.syncStatus === "created") {
    return "text-emerald-600 dark:text-emerald-500"
  }
  if (record.syncStatus === "failed") {
    return "text-destructive"
  }
  return "text-muted-foreground"
}

/** Saved words, newest first, with the Notion half of each row's story. */
export function WordBookList({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { data: records, refetch } = useQuery({
    queryKey: ["word-book"],
    queryFn: async () => await sendMessage("wordBookList"),
  })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAll, setBusyAll] = useState(false)

  const handleRetry = async (id: string) => {
    setBusyId(id)
    try {
      await sendMessage("wordBookRetry", { id })
      await refetch()
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async (id: string) => {
    setBusyId(id)
    try {
      await sendMessage("wordBookRemove", { id })
      await refetch()
    } finally {
      setBusyId(null)
    }
  }

  const handleRetryAll = async () => {
    setBusyAll(true)
    try {
      await sendMessage("wordBookSyncPending")
      await refetch()
    } finally {
      setBusyAll(false)
    }
  }

  const pendingCount = records?.filter((record) => record.syncStatus !== "created").length ?? 0

  return (
    <ConfigSection hideTitle={!showHeading} title={i18n.t("wordBook.panel.words")}>
      <div className="flex items-center justify-between gap-3">
        {records?.length === 0 && (
          <p className="text-sm text-muted-foreground">{i18n.t("wordBook.panel.empty")}</p>
        )}
        {pendingCount > 0 && (
          <Button
            disabled={busyAll}
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => void handleRetryAll()}
          >
            {i18n.t("wordBook.panel.retryAll")}
          </Button>
        )}
      </div>

      {records && records.length > 0 && (
        <ul className="flex flex-col rounded-md border">
          {records.map((record) => (
            <li
              key={record.id}
              className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{record.word}</span>
                  <span
                    className={`text-xs ${statusClassName(record)}`}
                    title={record.syncError ?? undefined}
                  >
                    {i18n.t(STATUS_KEY[record.syncStatus])}
                  </span>
                </div>
                <p className="line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">
                  {record.definition}
                </p>
                {record.context && (
                  <p className="line-clamp-2 text-xs whitespace-pre-line text-muted-foreground/80">
                    {record.context}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {record.notionUrl && (
                  <Button
                    render={<a href={record.notionUrl} rel="noopener noreferrer" target="_blank" />}
                    size="sm"
                    variant="ghost"
                  >
                    {i18n.t("wordBook.panel.openInNotion")}
                  </Button>
                )}
                {record.syncStatus !== "created" && (
                  <Button
                    disabled={busyId === record.id}
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleRetry(record.id)}
                  >
                    {i18n.t("wordBook.panel.retry")}
                  </Button>
                )}
                <Button
                  disabled={busyId === record.id}
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleRemove(record.id)}
                >
                  {i18n.t("wordBook.panel.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </ConfigSection>
  )
}
