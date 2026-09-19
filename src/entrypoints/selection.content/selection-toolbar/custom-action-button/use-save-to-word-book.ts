import type { WordBookAddResult } from "@/utils/word-book/sync"
import type { WordBookDraft } from "@/utils/word-book/types"
import { useState } from "react"
import { toastManager } from "@/components/ui/base-ui/toast"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { WORD_BOOK_SYNC_ERROR } from "@/utils/word-book/sync"

/**
 * The entry is stored locally first, so the toast reports the Notion half
 * separately: a missing connection or a refused write is not a lost word.
 */
function describeSyncOutcome(record: WordBookAddResult["record"]): string | undefined {
  if (record.syncStatus === "created") {
    return i18n.t("wordBook.syncedToNotion")
  }
  if (record.syncError === WORD_BOOK_SYNC_ERROR.NOT_CONFIGURED) {
    return i18n.t("wordBook.notionNotConnected")
  }
  if (record.syncStatus === "failed") {
    return i18n.t("wordBook.syncFailed")
  }
  return undefined
}

export interface WordBookSaveOutcome {
  /** Entries that were not in the book before. */
  created: number
  /** Entries that could not be written at all. */
  failed: number
}

/**
 * Writing several entries is sequential on purpose: the store reads the whole
 * table per write, so parallel adds would race each other's read-modify-write.
 */
export function useSaveToWordBook() {
  const [isSaving, setIsSaving] = useState(false)

  const saveAll = async (drafts: WordBookDraft[]): Promise<WordBookSaveOutcome> => {
    if (drafts.length === 0 || isSaving) {
      return { created: 0, failed: 0 }
    }

    setIsSaving(true)
    try {
      let created = 0
      let failed = 0
      let lastRecord: WordBookAddResult["record"] | undefined
      for (const draft of drafts) {
        if (!draft.word.trim()) {
          continue
        }
        try {
          const { record, created: isNew } = await sendMessage("wordBookAdd", draft)
          lastRecord = record
          if (isNew) {
            created += 1
          }
        } catch {
          failed += 1
        }
      }

      if (failed > 0 && created === 0) {
        toastManager.add({ type: "error", title: i18n.t("wordBook.saveFailed") })
      } else {
        toastManager.add({
          type: "success",
          title:
            created > 1
              ? i18n.t("wordBook.savedCount", [created])
              : i18n.t(created === 1 ? "wordBook.saved" : "wordBook.alreadySaved"),
          description: lastRecord ? describeSyncOutcome(lastRecord) : undefined,
        })
      }

      return { created, failed }
    } finally {
      setIsSaving(false)
    }
  }

  const save = (draft: WordBookDraft) => saveAll([draft])

  return { save, saveAll, isSaving }
}
