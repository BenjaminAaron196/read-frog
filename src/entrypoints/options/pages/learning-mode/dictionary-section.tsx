import type { LearningDictionaryMeta, LearningDictionaryPayload } from "@/utils/learning-mode/types"
import { Icon } from "@iconify/react"
import { useEffect, useState } from "react"
import { z } from "zod"
import { browser } from "#imports"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/base-ui/alert-dialog"
import { Button } from "@/components/ui/base-ui/button"
import { Label } from "@/components/ui/base-ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { toastManager } from "@/components/ui/base-ui/toast"
import {
  LEARNING_DICTIONARY_ENTRIES_KEY,
  LEARNING_DICTIONARY_META_KEY,
} from "@/utils/constants/learning-mode"
import { i18n } from "@/utils/i18n"
import { readDictionaryMeta } from "@/utils/learning-mode/lookup"
import { ConfigItem } from "../../components/config-item"
import { ConfigSection } from "../../components/config-section"

const IMPORT_INPUT_ID = "learning-mode-dictionary-import"

const VARIANTS = ["lite", "full"] as const
type DictionaryVariant = (typeof VARIANTS)[number]

const VARIANT_LABEL_KEY = {
  lite: "learningMode.dictionary.status.variantLite",
  full: "learningMode.dictionary.status.variantFull",
} as const satisfies Record<DictionaryVariant, string>

/**
 * What an imported file has to be. `meta` is checked field by field because that
 * is where a wrong file shows itself first; of the entries only the headword is,
 * both because a row without one would sit in the dictionary unseen and because
 * a build script wrote the other twelve fields — a page token is lowercased
 * before it is looked up, so an upper-case headword would never match one.
 */
const dictionaryArtifactSchema = z.object({
  meta: z.object({
    version: z.string().min(1),
    variant: z.enum(VARIANTS),
    entries: z.number().int().nonnegative().optional(),
    /** Byte length of the artifact file itself, as the builder wrote it. */
    bytes: z.number().nonnegative().optional(),
    importedAt: z.number().optional(),
    source: z.string().optional(),
  }),
  entries: z.array(z.looseObject({ w: z.string().regex(/^[^A-Z]+$/) })).min(1),
})

type ImportOutcome =
  | { ok: true; payload: LearningDictionaryPayload }
  | { ok: false; message: string }

/** Magic-constant arithmetic worth a name of its own; the call sites read numbers. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Turns a picked file into the pair of storage values, or into the sentence that
 * says why it cannot be one. Every rejection here is something the user can act
 * on: the other variant, a truncated download, or a file that is not an artifact.
 *
 * `meta.bytes` is the size of the file the builder wrote, so a file smaller than
 * its own claim lost bytes on the way to disk. `entries.length` is authoritative
 * once the array is in hand — the stored `meta.entries` is rewritten from it.
 */
function readArtifact(text: string, file: File, variant: DictionaryVariant): ImportOutcome {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, message: i18n.t("learningMode.dictionary.import.invalidFile") }
  }

  const artifact = dictionaryArtifactSchema.safeParse(parsed)
  if (!artifact.success) {
    const rowIssue = artifact.error.issues.find((issue) => issue.path[0] === "entries")
    if (rowIssue) {
      return {
        ok: false,
        message: i18n.t("learningMode.dictionary.import.invalidEntries", [
          String(Number(rowIssue.path[1]) + 1),
        ]),
      }
    }
    return { ok: false, message: i18n.t("learningMode.dictionary.import.invalidFile") }
  }

  const { meta, entries } = artifact.data

  if (meta.variant !== variant) {
    return {
      ok: false,
      message: i18n.t("learningMode.dictionary.import.variantMismatch", [
        i18n.t(VARIANT_LABEL_KEY[meta.variant]),
      ]),
    }
  }

  if (meta.bytes !== undefined && file.size < meta.bytes) {
    return {
      ok: false,
      message: i18n.t("learningMode.dictionary.import.truncated", [
        formatBytes(meta.bytes),
        formatBytes(file.size),
      ]),
    }
  }

  if (meta.entries !== undefined && meta.entries !== entries.length) {
    return {
      ok: false,
      message: i18n.t("learningMode.dictionary.import.entryCountMismatch", [
        String(meta.entries),
        String(entries.length),
      ]),
    }
  }

  return {
    ok: true,
    payload: {
      // Import time, not build time: the status shows when THIS copy arrived.
      meta: {
        version: meta.version,
        variant: meta.variant,
        entries: entries.length,
        bytes: meta.bytes ?? file.size,
        importedAt: Date.now(),
        // The builder's provenance line names the corpora the rows came from,
        // which a file name does not; a re-serialized artifact that lost it
        // still says where this copy came from.
        source: meta.source ?? file.name,
      },
      // The rows are the builder's compact shape; the schema pins the one field
      // every consumer reads and the rest are read defensively downstream.
      entries,
    },
  }
}

/**
 * The dictionary the marks are judged against. It is a file the user picks, not
 * something the extension fetches: it holds tens of thousands of entries, so it
 * is kept under its own extension-storage keys and read by the content script
 * directly (`utils/learning-mode/lookup.ts`) instead of crossing the message bus.
 */
export function DictionarySection() {
  const [meta, setMeta] = useState<LearningDictionaryMeta | null>(null)
  const [variant, setVariant] = useState<DictionaryVariant>("lite")
  const [isImporting, setIsImporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)

  useEffect(() => {
    void (async () => {
      const stored = await readDictionaryMeta()
      setMeta(stored)
      if (stored) setVariant(stored.variant)
    })()
  }, [])

  const handleImport = async (file: File) => {
    setIsImporting(true)
    try {
      const outcome = readArtifact(await file.text(), file, variant)
      if (!outcome.ok) {
        toastManager.add({ type: "error", title: outcome.message })
        return
      }

      const { meta: storedMeta, entries } = outcome.payload
      // Both keys or neither: a meta without its entries would report a
      // dictionary that marks nothing, and the reverse is no better.
      await browser.storage.local.set({
        [LEARNING_DICTIONARY_META_KEY]: storedMeta,
        [LEARNING_DICTIONARY_ENTRIES_KEY]: entries,
      })
      setMeta(storedMeta)

      toastManager.add({
        type: "success",
        title: i18n.t("learningMode.dictionary.import.success", [
          storedMeta.entries.toLocaleString(),
          formatBytes(storedMeta.bytes),
        ]),
      })
    } catch (error) {
      toastManager.add({
        type: "error",
        title: i18n.t("learningMode.dictionary.import.invalidFile"),
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsImporting(false)
    }
  }

  const handleClear = async () => {
    setIsClearing(true)
    try {
      await browser.storage.local.remove([
        LEARNING_DICTIONARY_META_KEY,
        LEARNING_DICTIONARY_ENTRIES_KEY,
      ])
      setMeta(null)
      toastManager.add({
        type: "success",
        title: i18n.t("learningMode.dictionary.clear.success"),
      })
    } catch (error) {
      toastManager.add({
        type: "error",
        title: i18n.t("learningMode.dictionary.clear.failed"),
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setIsClearing(false)
      setIsConfirmingClear(false)
    }
  }

  return (
    <ConfigSection id="learning-mode-dictionary" title={i18n.t("learningMode.dictionary.title")}>
      <ConfigItem
        id="learning-mode-dictionary-status"
        title={i18n.t("learningMode.dictionary.status.title")}
        description={meta ? undefined : i18n.t("learningMode.dictionary.status.empty")}
        orientation="vertical"
      >
        {meta ? (
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span>{i18n.t("learningMode.dictionary.status.variant")}</span>
            <span className="text-foreground">{i18n.t(VARIANT_LABEL_KEY[meta.variant])}</span>
            <span>{i18n.t("learningMode.dictionary.status.version")}</span>
            <span className="text-foreground">{meta.version}</span>
            <span>{i18n.t("learningMode.dictionary.status.entries")}</span>
            <span className="text-foreground">{meta.entries.toLocaleString()}</span>
            <span>{i18n.t("learningMode.dictionary.status.size")}</span>
            <span className="text-foreground">{formatBytes(meta.bytes)}</span>
            <span>{i18n.t("learningMode.dictionary.status.importedAt")}</span>
            <span className="text-foreground">{new Date(meta.importedAt).toLocaleString()}</span>
            <span>{i18n.t("learningMode.dictionary.status.source")}</span>
            <span className="break-all text-foreground">{meta.source}</span>
          </div>
        ) : null}
      </ConfigItem>

      <ConfigItem
        id="learning-mode-dictionary-variant"
        title={i18n.t("learningMode.dictionary.variant.title")}
        // Qualifies the picker: choosing here stores nothing on its own, which is
        // exactly the part that is easy to misread next to an import button.
        description={i18n.t("learningMode.dictionary.variant.description")}
      >
        <Select
          items={VARIANTS.map((option) => ({
            value: option,
            label: i18n.t(VARIANT_LABEL_KEY[option]),
          }))}
          value={variant}
          onValueChange={(value) => {
            const parsedVariant = z.enum(VARIANTS).safeParse(value)
            if (parsedVariant.success) setVariant(parsedVariant.data)
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {VARIANTS.map((option) => (
                <SelectItem key={option} value={option}>
                  {i18n.t(VARIANT_LABEL_KEY[option])}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </ConfigItem>

      <ConfigItem
        id="learning-mode-dictionary-import"
        title={i18n.t("learningMode.dictionary.import.title")}
        description={i18n.t("learningMode.dictionary.import.description")}
      >
        <Button variant="outline" size="sm" className="p-0" disabled={isImporting}>
          {/* The label fills the button so the whole control opens the picker. */}
          <Label htmlFor={IMPORT_INPUT_ID} className="w-full gap-1 px-2.5 text-[length:inherit]">
            <Icon icon="tabler:file-import" />
            {isImporting
              ? i18n.t("learningMode.dictionary.import.importing")
              : i18n.t("learningMode.dictionary.import.action")}
          </Label>
        </Button>
        <input
          id={IMPORT_INPUT_ID}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared before the read: picking the SAME file again after a
            // rejection has to fire a change event.
            event.target.value = ""
            if (file) void handleImport(file)
          }}
        />
      </ConfigItem>

      <ConfigItem
        id="learning-mode-dictionary-clear"
        title={i18n.t("learningMode.dictionary.clear.title")}
        description={i18n.t("learningMode.dictionary.clear.description")}
      >
        <AlertDialog open={isConfirmingClear} onOpenChange={setIsConfirmingClear}>
          <AlertDialogTrigger
            render={<Button variant="destructive" size="sm" disabled={isClearing || !meta} />}
          >
            <Icon icon="tabler:trash" />
            {i18n.t("learningMode.dictionary.clear.action")}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {i18n.t("learningMode.dictionary.clear.dialog.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {i18n.t("learningMode.dictionary.clear.dialog.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>
                {i18n.t("learningMode.dictionary.clear.dialog.cancel")}
              </AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleClear} disabled={isClearing}>
                {isClearing
                  ? i18n.t("learningMode.dictionary.clear.clearing")
                  : i18n.t("learningMode.dictionary.clear.dialog.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </ConfigItem>
    </ConfigSection>
  )
}
