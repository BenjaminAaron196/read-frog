import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { useAtomValue } from "jotai"
import { Button } from "@/components/ui/base-ui/button"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { buildWordBookDraft } from "@/utils/word-book/capture"
import { useSaveToWordBook } from "./use-save-to-word-book"

interface SaveToWordBookButtonProps {
  action: SelectionToolbarCustomAction
  isRunning: boolean
  result: Record<string, unknown> | null
  selectionText: string
  contextText: string
  sourceTitle: string
  sourceUrl: string
}

/**
 * Sits beside the Notebase button in the dictionary result's footer: the word
 * is captured with the definition the user is looking at, so saving never
 * triggers a second model call.
 */
export function SaveToWordBookButton({
  action,
  isRunning,
  result,
  selectionText,
  contextText,
  sourceTitle,
  sourceUrl,
}: SaveToWordBookButtonProps) {
  const wordBook = useAtomValue(configFieldsAtomMap.wordBook)
  const { save, isSaving } = useSaveToWordBook()

  const handleClick = () => {
    if (!result) {
      return
    }

    void save(
      buildWordBookDraft({ action, result, selectionText, contextText, sourceTitle, sourceUrl }),
    )
  }

  if (!wordBook.enabled) {
    return null
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={isRunning || !result || isSaving || !selectionText.trim()}
      onClick={handleClick}
    >
      {isSaving ? i18n.t("wordBook.saving") : i18n.t("wordBook.save")}
    </Button>
  )
}
