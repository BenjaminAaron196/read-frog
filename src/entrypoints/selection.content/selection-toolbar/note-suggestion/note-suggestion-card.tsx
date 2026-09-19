import type { NoteSuggestionSessionResult } from "./use-note-suggestion"
import type { NoteSuggestionNoteRecord } from "@/utils/note-suggestion/types"
import { IconBookmarkPlus, IconLoader2 } from "@tabler/icons-react"
import { useAtom, useAtomValue } from "jotai"
import { useEffect, useId, useState } from "react"
import { Button } from "@/components/ui/base-ui/button"
import { Checkbox } from "@/components/ui/base-ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/base-ui/field"
import { Label } from "@/components/ui/base-ui/label"
import { Switch } from "@/components/ui/base-ui/switch"
import { toastManager } from "@/components/ui/base-ui/toast"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { findSelectionToolbarAction } from "@/utils/custom-actions"
import { i18n } from "@/utils/i18n"
import { trackNoteSuggestionEvent } from "@/utils/note-suggestion/analytics"
import { getOutputSchemaFingerprint } from "@/utils/notebase/pending-save"
import { buildWordBookDraft } from "@/utils/word-book/capture"
import { useSaveToNotebase } from "../custom-action-button/use-save-to-notebase"
import { useSaveToWordBook } from "../custom-action-button/use-save-to-word-book"

function formatNoteValue(value: string | number | null): string | null {
  if (value === null) {
    return null
  }

  const text = typeof value === "number" ? String(value) : value.trim()
  return text.length > 0 ? text : null
}

function NoteRow({
  note,
  checkboxId,
  checked,
  disabled,
  primaryFieldName,
  secondaryFieldNames,
  onCheckedChange,
}: {
  note: NoteSuggestionNoteRecord
  checkboxId: string
  checked: boolean
  disabled: boolean
  primaryFieldName: string
  secondaryFieldNames: string[]
  onCheckedChange: (checked: boolean) => void
}) {
  const primaryValue = formatNoteValue(note[primaryFieldName] ?? null)
  const secondaryValue = secondaryFieldNames
    .map((fieldName) => formatNoteValue(note[fieldName] ?? null))
    .find((value) => value !== null)

  return (
    <FieldLabel htmlFor={checkboxId}>
      <Field orientation="horizontal" data-disabled={disabled || undefined} className="gap-2 p-2!">
        <Checkbox
          id={checkboxId}
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
        <FieldContent className="min-w-0 gap-0.5">
          <FieldTitle>{primaryValue}</FieldTitle>
          {secondaryValue && (
            <FieldDescription className="text-xs">{secondaryValue}</FieldDescription>
          )}
        </FieldContent>
      </Field>
    </FieldLabel>
  )
}

/**
 * Title and on/off switch, shared by the ready card and the pending one so the
 * two cannot drift apart.
 */
function NoteSuggestionHeader() {
  const [selectionToolbar, setSelectionToolbar] = useAtom(configFieldsAtomMap.selectionToolbar)

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
        <IconBookmarkPlus className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <span className="truncate">{i18n.t("noteSuggestion.title")}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          id="note-suggestion-toggle"
          size="sm"
          checked={selectionToolbar.noteSuggestion.enabled}
          onCheckedChange={(checked) => {
            void setSelectionToolbar({
              noteSuggestion: { ...selectionToolbar.noteSuggestion, enabled: checked },
            })
          }}
        />
        <Label
          htmlFor="note-suggestion-toggle"
          className="text-xs font-normal text-muted-foreground"
        >
          {i18n.t("noteSuggestion.toggleLabel")}
        </Label>
      </div>
    </div>
  )
}

/**
 * What the card shows while the request runs, and when it failed. The feature
 * cannot stay invisible while it works: a silent suggestion looks exactly like
 * a suggestion that found nothing.
 */
export function NoteSuggestionPendingCard({
  mode,
  message,
}: {
  mode: "loading" | "error"
  message?: string | null
}) {
  return (
    <div
      data-slot="note-suggestion-card"
      data-state={mode}
      className="notranslate mx-4 mb-4 animate-in space-y-2 rounded-lg border bg-muted/40 p-3 duration-200 fade-in-0"
    >
      <NoteSuggestionHeader />
      {mode === "loading" ? (
        <>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <IconLoader2 className="size-3.5 animate-spin" strokeWidth={2} />
            {i18n.t("noteSuggestion.loading")}
          </p>
          <div className="space-y-1.5 pt-0.5" aria-hidden="true">
            {[0, 1].map((row) => (
              <div
                key={row}
                className="animate-pulse space-y-1 rounded-md border border-dashed p-2"
                style={{ animationDelay: `${row * 120}ms` }}
              >
                <div className="h-3 w-24 rounded bg-muted-foreground/20" />
                <div className="h-2.5 w-40 rounded bg-muted-foreground/10" />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-destructive">
          {i18n.t("noteSuggestion.failed")}
          {message ? `: ${message}` : null}
        </p>
      )}
    </div>
  )
}

export function NoteSuggestionCard({
  suggestion,
  markShownOnce,
  selectionText,
  contextText,
  sourceTitle,
  sourceUrl,
}: {
  suggestion: NoteSuggestionSessionResult
  markShownOnce: (sessionKey: string) => boolean
  /** The selection the notes were suggested for; the word book keeps it as context. */
  selectionText: string
  contextText: string
  sourceTitle: string
  sourceUrl: string
}) {
  const { sessionKey, validated, actionSnapshot, firedAt, analyticsProvider } = suggestion
  const [selectionToolbar] = useAtom(configFieldsAtomMap.selectionToolbar)
  const wordBook = useAtomValue(configFieldsAtomMap.wordBook)
  const { save, isSaving } = useSaveToNotebase()
  const { saveAll, isSaving: isSavingToWordBook } = useSaveToWordBook()
  const [saveState, setSaveState] = useState<"idle" | "saved" | "stale">("idle")
  const [wordBookSaved, setWordBookSaved] = useState(false)
  const checkboxBaseId = useId()
  const [selectedNoteIndexes, setSelectedNoteIndexes] = useState(
    () => new Set(validated.notes.map((_note, index) => index)),
  )

  useEffect(() => {
    if (!markShownOnce(sessionKey)) {
      return
    }

    trackNoteSuggestionEvent("suggestion_shown", {
      startedAt: firedAt,
      provider: analyticsProvider,
    })
  }, [markShownOnce, sessionKey, firedAt, analyticsProvider])

  const primaryFieldName = actionSnapshot.outputSchema[0]?.name
  if (!primaryFieldName) {
    return null
  }
  // Secondary line preference: the AI-designated summary field first (it
  // knows which field explains the term, whatever the user named it), then
  // definition-like fields (dictionary template's stable ids), then schema
  // order. Later entries only show when earlier ones are empty.
  const aiSummaryFieldName = validated.summaryFieldName
  const secondaryFields = actionSnapshot.outputSchema.slice(1)
  const secondaryFieldNames = [
    ...secondaryFields.filter((field) => field.name === aiSummaryFieldName),
    ...secondaryFields.filter(
      (field) => field.name !== aiSummaryFieldName && field.id.includes("definition"),
    ),
    ...secondaryFields.filter(
      (field) => field.name !== aiSummaryFieldName && !field.id.includes("definition"),
    ),
  ].map((field) => field.name)
  const selectedNotes = validated.notes.filter((_note, index) => selectedNoteIndexes.has(index))

  const handleSave = async () => {
    const liveAction = findSelectionToolbarAction(selectionToolbar, actionSnapshot.id)
    if (
      !liveAction ||
      getOutputSchemaFingerprint(liveAction.outputSchema) !==
        getOutputSchemaFingerprint(actionSnapshot.outputSchema)
    ) {
      toastManager.add({ type: "error", title: i18n.t("noteSuggestion.staleSuggestion") })
      setSaveState("stale")
      return
    }

    const outcome = await save({
      action: liveAction,
      results: selectedNotes,
      analyticsSource: "note_suggestion",
      analyticsProvider,
    })
    if (outcome === "saved") {
      setSaveState("saved")
      trackNoteSuggestionEvent("suggestion_accepted", {
        startedAt: firedAt,
        actionName: liveAction.name,
        provider: analyticsProvider,
      })
    }
  }

  /**
   * The word book reads the note records by the snapshot's field names, so a
   * config edit mid-session cannot invalidate this save the way it can for the
   * Notebase columns - the notes on screen are exactly what gets stored.
   */
  const handleSaveToWordBook = async () => {
    const drafts = selectedNotes.map((note) =>
      buildWordBookDraft({
        action: actionSnapshot,
        result: note,
        selectionText,
        contextText,
        sourceTitle,
        sourceUrl,
      }),
    )

    const { failed } = await saveAll(drafts)
    if (failed === 0 && drafts.length > 0) {
      setWordBookSaved(true)
      trackNoteSuggestionEvent("suggestion_accepted", {
        startedAt: firedAt,
        actionName: actionSnapshot.name,
        provider: analyticsProvider,
      })
    }
  }

  const isBusy = isSaving || isSavingToWordBook
  const isInteractionDisabled = isBusy || saveState !== "idle" || wordBookSaved
  const isButtonDisabled = isInteractionDisabled || selectedNotes.length === 0
  const buttonLabel = isSaving
    ? i18n.t("action.saveToNotebaseSaving")
    : saveState === "saved"
      ? i18n.t("noteSuggestion.saved")
      : i18n.t("noteSuggestion.save")

  return (
    <div
      data-slot="note-suggestion-card"
      className="notranslate mx-4 mb-4 animate-in space-y-2 rounded-lg border bg-muted/40 p-3 duration-200 fade-in-0"
    >
      <NoteSuggestionHeader />
      <p className="text-xs text-muted-foreground">{i18n.t("noteSuggestion.description")}</p>
      <div className="space-y-1">
        {validated.notes.map((note, index) => (
          <NoteRow
            // oxlint-disable-next-line react/no-array-index-key -- notes are a stable per-session snapshot
            key={index}
            note={note}
            checkboxId={`${checkboxBaseId}-${index}`}
            checked={selectedNoteIndexes.has(index)}
            disabled={isInteractionDisabled}
            primaryFieldName={primaryFieldName}
            secondaryFieldNames={secondaryFieldNames}
            onCheckedChange={(checked) => {
              setSelectedNoteIndexes((currentIndexes) => {
                const nextIndexes = new Set(currentIndexes)
                if (checked) {
                  nextIndexes.add(index)
                } else {
                  nextIndexes.delete(index)
                }
                return nextIndexes
              })
            }}
          />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        {wordBook.enabled && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isButtonDisabled}
            onClick={() => void handleSaveToWordBook()}
          >
            {wordBookSaved
              ? i18n.t("noteSuggestion.savedToNotion")
              : i18n.t("noteSuggestion.saveToNotion")}
          </Button>
        )}
        <Button
          type="button"
          variant="brand"
          size="sm"
          disabled={isButtonDisabled}
          onClick={() => void handleSave()}
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  )
}
