import type {
  DictionaryDownloadProgress,
  DictionaryVariant,
} from "@/utils/learning-mode/dictionary-download"
import type { LearningDictionaryMeta } from "@/utils/learning-mode/types"
import { Icon } from "@iconify/react"
import { useAtom } from "jotai"
import { useEffect, useRef, useState } from "react"
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
import { Progress, ProgressLabel } from "@/components/ui/base-ui/progress"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { Textarea } from "@/components/ui/base-ui/textarea"
import { toastManager } from "@/components/ui/base-ui/toast"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import {
  LEARNING_DICTIONARY_ENTRIES_KEY,
  LEARNING_DICTIONARY_META_KEY,
} from "@/utils/constants/learning-mode"
import { i18n } from "@/utils/i18n"
import {
  DICTIONARY_VARIANTS,
  DictionaryImportError,
  downloadAndImportDictionary,
  formatBytes,
  importDictionaryPayload,
  parseDictionaryArtifact,
  resolveDictionarySource,
  resolveManifestUrl,
} from "@/utils/learning-mode/dictionary-download"
import { readDictionaryMeta } from "@/utils/learning-mode/lookup"
import { cn } from "@/utils/styles/utils"
import { ConfigItem } from "../../components/config-item"
import { ConfigSection } from "../../components/config-section"

const IMPORT_INPUT_ID = "learning-mode-dictionary-import"

const variantSchema = z.enum(DICTIONARY_VARIANTS)

const VARIANT_LABEL_KEY = {
  lite: "learningMode.dictionary.status.variantLite",
  full: "learningMode.dictionary.status.variantFull",
} as const satisfies Record<DictionaryVariant, string>

/** What the last source check found, or why it found nothing. */
type SourceCheck =
  | { ok: true; source: string; version: string; entries: number; bytes: number }
  | { ok: false; message: string }

/** What the last download did, for the line under its button. */
type DownloadOutcome =
  | { ok: true; source: string; version: string; entries: number; bytes: number }
  | { ok: false; message: string }

/** The label a variant is shown under, whether it arrives from the picker or a manifest. */
function variantLabel(raw: string): string {
  const parsed = variantSchema.safeParse(raw)
  return parsed.success ? i18n.t(VARIANT_LABEL_KEY[parsed.data]) : raw
}

/** How far the bar stands, and what to print beside it. */
function describeProgress(progress: DictionaryDownloadProgress): {
  percent: number | null
  label: string
} {
  // No declared length means no fraction to show; the bytes still count up, which is
  // the only honest thing a chunked response allows.
  if (progress.total === null) {
    return {
      percent: null,
      label: i18n.t("learningMode.dictionary.download.progressUnknown", [
        formatBytes(progress.received),
      ]),
    }
  }

  const percent = Math.min(100, Math.round((progress.received / progress.total) * 100))
  return {
    percent,
    label: i18n.t("learningMode.dictionary.download.progress", [
      formatBytes(progress.received),
      formatBytes(progress.total),
      String(percent),
    ]),
  }
}

/**
 * One sentence per rejection. The download layer raises codes and the values they name,
 * never text: this is the one place where a rejection becomes something the reader can
 * act on, and the local-file path reports through the same codes.
 */
function describeImportError(error: unknown): string {
  if (!(error instanceof DictionaryImportError)) {
    return error instanceof Error
      ? error.message
      : i18n.t("learningMode.dictionary.download.failed")
  }

  const [first = "", second = ""] = error.params

  switch (error.code) {
    case "network":
      return i18n.t("learningMode.dictionary.download.networkError", [first])
    case "http":
      return i18n.t("learningMode.dictionary.download.httpError", [second, first])
    case "empty":
      return i18n.t("learningMode.dictionary.download.emptyResponse", [first])
    case "manifest":
      return i18n.t("learningMode.dictionary.download.invalidManifest", [first])
    case "variant":
      return i18n.t("learningMode.dictionary.download.variantMissing", [variantLabel(first)])
    case "source":
      return first === ""
        ? i18n.t("learningMode.dictionary.download.noSources")
        : i18n.t("learningMode.dictionary.download.invalidSource", [first])
    case "truncated":
      return i18n.t("learningMode.dictionary.import.truncated", [first, second])
    case "size":
      return i18n.t("learningMode.dictionary.download.sizeMismatch", [first, second])
    case "checksum":
      return i18n.t("learningMode.dictionary.download.checksumMismatch", [first, second])
    case "entries":
      return i18n.t("learningMode.dictionary.download.entryCountMismatch", [first, second])
    case "invalidFile":
      return i18n.t("learningMode.dictionary.import.invalidFile")
    case "invalidEntries":
      return i18n.t("learningMode.dictionary.import.invalidEntries", [first])
    case "variantMismatch":
      return i18n.t("learningMode.dictionary.import.variantMismatch", [variantLabel(first)])
    default:
      return i18n.t("learningMode.dictionary.download.failed")
  }
}

/**
 * Where the download reads from, one URL per line — or comma separated, because these
 * are pasted in bulk far more often than they are edited one row at a time. Empty out
 * of the box: Read Frog hosts no artifact of its own, and the file import below works
 * without a source.
 */
function DictionarySourcesItem() {
  const [learningMode, setLearningMode] = useAtom(configFieldsAtomMap.learningMode)
  const stored = learningMode.dictionarySources.join("\n")
  const [draft, setDraft] = useState(stored)
  const [prevStored, setPrevStored] = useState(stored)

  // Reset the draft when the stored list changes from somewhere else.
  if (prevStored !== stored) {
    setPrevStored(stored)
    setDraft(stored)
  }

  const commit = () => {
    const sources = [...new Set(draft.split(/[\n,]+/).map((line) => line.trim()))].filter(
      (line) => line !== "",
    )
    // One line nobody can fetch rejects the whole edit rather than being dropped
    // silently: the URL the user typed is what the list has to say. The check is the
    // same one the download runs, so nothing here can be stored that would 404 later.
    for (const source of sources) {
      if (resolveManifestUrl(source) === null) {
        toastManager.add({
          type: "error",
          title: i18n.t("learningMode.dictionary.sources.invalid", [source]),
        })
        setDraft(stored)
        return
      }
    }

    void setLearningMode({ ...learningMode, dictionarySources: sources })
  }

  return (
    <ConfigItem
      id="learning-mode-dictionary-sources"
      title={i18n.t("learningMode.dictionary.sources.title")}
      description={i18n.t("learningMode.dictionary.sources.description")}
      orientation="vertical"
    >
      <Textarea
        value={draft}
        placeholder={i18n.t("learningMode.dictionary.sources.placeholder")}
        rows={3}
        className="font-mono text-[13px]"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
    </ConfigItem>
  )
}

/**
 * The dictionary the marks are judged against. It arrives one of two ways: fetched from
 * a published source and checked against that source's manifest, or picked as a file by
 * a reader who builds or mirrors it themselves. Either way it is kept under its own
 * extension-storage keys and read by the content script directly
 * (`utils/learning-mode/lookup.ts`) instead of crossing the message bus.
 */
export function DictionarySection() {
  const [learningMode] = useAtom(configFieldsAtomMap.learningMode)
  const sources = learningMode.dictionarySources

  const [meta, setMeta] = useState<LearningDictionaryMeta | null>(null)
  const [variant, setVariant] = useState<DictionaryVariant>("lite")
  const [isImporting, setIsImporting] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)
  const [isChecking, setIsChecking] = useState(false)
  /** Non-null only while a download is in flight. */
  const [progress, setProgress] = useState<DictionaryDownloadProgress | null>(null)
  const [check, setCheck] = useState<SourceCheck | null>(null)
  const [downloadOutcome, setDownloadOutcome] = useState<DownloadOutcome | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  /**
   * The file input is driven from the button's click handler rather than by a
   * `<label for>` inside it: a label nested in a button is not activated (the
   * click never reaches the input, and the picker silently does not open), which
   * is what made "Choose file" look dead.
   */
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    void (async () => {
      const stored = await readDictionaryMeta()
      setMeta(stored)
      if (stored) setVariant(stored.variant)
    })()
  }, [])

  // A check answers for one variant of one source list; when either changes, the answer
  // on screen is about a different question and goes away with it.
  const requestKey = `${variant}\n${sources.join("\n")}`
  const [prevRequestKey, setPrevRequestKey] = useState(requestKey)
  if (prevRequestKey !== requestKey) {
    setPrevRequestKey(requestKey)
    setCheck(null)
    setDownloadOutcome(null)
  }

  const isDownloading = progress !== null
  const isDownloadBlocked = isDownloading || isChecking || sources.length === 0
  const shownProgress = progress === null ? null : describeProgress(progress)
  const isCurrentBuild =
    check?.ok === true && meta?.variant === variant && meta.version === check.version

  const handleDownload = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    // Zero bytes of a known size: the bar stands at 0% until the first chunk lands,
    // instead of flickering through "indeterminate" first.
    setProgress({ received: 0, total: null })
    setDownloadOutcome(null)

    try {
      const result = await downloadAndImportDictionary(sources, variant, {
        signal: controller.signal,
        onProgress: setProgress,
      })
      setMeta(result.meta)
      setDownloadOutcome({
        ok: true,
        source: result.source,
        version: result.meta.version,
        entries: result.meta.entries,
        bytes: result.meta.bytes,
      })
      toastManager.add({
        type: "success",
        title: i18n.t("learningMode.dictionary.download.success", [
          result.meta.entries.toLocaleString(),
          formatBytes(result.meta.bytes),
        ]),
      })
    } catch (error) {
      // An aborted request is the page closing under it, not something to report.
      if (controller.signal.aborted) return
      const message = describeImportError(error)
      setDownloadOutcome({ ok: false, message })
      toastManager.add({
        type: "error",
        title: message,
        // A typed rejection already says what went wrong; anything else keeps its own
        // message, which is the only clue it will give.
        description:
          error instanceof DictionaryImportError
            ? undefined
            : error instanceof Error
              ? error.message
              : undefined,
      })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setProgress(null)
    }
  }

  /**
   * Asks the sources what they are serving right now. The download does the same walk
   * before it fetches anything, so this is for the reader who wants to know whether a
   * rebuild is out before spending the transfer — and for the one whose last download
   * was rejected and wants the source checked again without re-downloading.
   */
  const handleCheck = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setIsChecking(true)
    setCheck(null)
    setDownloadOutcome(null)

    try {
      const resolved = await resolveDictionarySource(sources, variant, {
        signal: controller.signal,
      })
      setCheck({
        ok: true,
        source: resolved.source,
        version: resolved.manifest.version,
        entries: resolved.record.entries,
        bytes: resolved.record.bytes,
      })
    } catch (error) {
      if (controller.signal.aborted) return
      setCheck({ ok: false, message: describeImportError(error) })
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setIsChecking(false)
    }
  }

  const handleImport = async (file: File) => {
    setIsImporting(true)
    try {
      // The picked file is its own witness: no manifest vouched for its bytes, so the
      // verdict is the artifact's own claims plus the fact that the picker could read
      // it whole.
      const payload = parseDictionaryArtifact(await file.text(), {
        variant,
        source: file.name,
        bytes: file.size,
        countedBy: "picker",
      })
      const storedMeta = await importDictionaryPayload(payload)
      setMeta(storedMeta)
      setDownloadOutcome(null)

      toastManager.add({
        type: "success",
        title: i18n.t("learningMode.dictionary.import.success", [
          storedMeta.entries.toLocaleString(),
          formatBytes(storedMeta.bytes),
        ]),
      })
    } catch (error) {
      toastManager.add({ type: "error", title: describeImportError(error) })
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

      <DictionarySourcesItem />

      <ConfigItem
        id="learning-mode-dictionary-variant"
        title={i18n.t("learningMode.dictionary.variant.title")}
        // Qualifies the picker: choosing here stores nothing on its own, which is
        // exactly the part that is easy to misread next to a download button.
        description={i18n.t("learningMode.dictionary.variant.description")}
      >
        <Select
          items={DICTIONARY_VARIANTS.map((option) => ({
            value: option,
            label: i18n.t(VARIANT_LABEL_KEY[option]),
          }))}
          value={variant}
          onValueChange={(value) => {
            const parsedVariant = variantSchema.safeParse(value)
            if (parsedVariant.success) setVariant(parsedVariant.data)
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {DICTIONARY_VARIANTS.map((option) => (
                <SelectItem key={option} value={option}>
                  {i18n.t(VARIANT_LABEL_KEY[option])}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </ConfigItem>

      <ConfigItem
        id="learning-mode-dictionary-download"
        title={i18n.t("learningMode.dictionary.download.title")}
        description={i18n.t("learningMode.dictionary.download.description")}
        orientation="vertical"
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isDownloadBlocked} onClick={() => void handleDownload()}>
              <Icon
                icon={isDownloading ? "tabler:loader-2" : "tabler:cloud-download"}
                className={isDownloading ? "animate-spin" : undefined}
              />
              {isDownloading
                ? i18n.t("learningMode.dictionary.download.downloading")
                : i18n.t("learningMode.dictionary.download.action")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isDownloadBlocked}
              onClick={() => void handleCheck()}
            >
              <Icon
                icon={isChecking ? "tabler:loader-2" : "tabler:refresh"}
                className={isChecking ? "animate-spin" : undefined}
              />
              {isChecking
                ? i18n.t("learningMode.dictionary.download.checking")
                : i18n.t("learningMode.dictionary.download.check")}
            </Button>
          </div>

          {sources.length === 0 ? (
            <p className="text-[13px] leading-[18px] text-muted-foreground">
              {i18n.t("learningMode.dictionary.download.noSources")}
            </p>
          ) : null}

          {shownProgress ? (
            <Progress
              value={shownProgress.percent}
              className="gap-x-3 gap-y-1.5"
              // The label names the build being fetched and the value repeats the bytes
              // the span shows: a bare percentage says nothing about a 15 MB file.
              getAriaValueText={() => shownProgress.label}
            >
              <ProgressLabel>{i18n.t(VARIANT_LABEL_KEY[variant])}</ProgressLabel>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {shownProgress.label}
              </span>
            </Progress>
          ) : null}

          {downloadOutcome ? (
            <p
              className={cn(
                "text-[13px] leading-[18px]",
                downloadOutcome.ok ? "text-muted-foreground" : "text-destructive",
              )}
            >
              {downloadOutcome.ok
                ? i18n.t("learningMode.dictionary.download.imported", [
                    downloadOutcome.source,
                    downloadOutcome.version,
                    downloadOutcome.entries.toLocaleString(),
                    formatBytes(downloadOutcome.bytes),
                  ])
                : downloadOutcome.message}
            </p>
          ) : null}

          {check ? (
            check.ok ? (
              <div className="flex flex-col gap-0.5 text-[13px] leading-[18px] text-muted-foreground">
                <span>
                  {i18n.t("learningMode.dictionary.download.checkFound", [
                    check.source,
                    check.version,
                    check.entries.toLocaleString(),
                    formatBytes(check.bytes),
                  ])}
                </span>
                {isCurrentBuild ? (
                  <span>{i18n.t("learningMode.dictionary.download.checkCurrent")}</span>
                ) : null}
              </div>
            ) : (
              <p className="text-[13px] leading-[18px] text-destructive">{check.message}</p>
            )
          ) : null}
        </div>
      </ConfigItem>

      <ConfigItem
        id="learning-mode-dictionary-import"
        title={i18n.t("learningMode.dictionary.import.title")}
        description={i18n.t("learningMode.dictionary.import.description")}
      >
        <Button
          variant="outline"
          size="sm"
          disabled={isImporting}
          onClick={() => fileInputRef.current?.click()}
        >
          <Icon icon="tabler:file-import" />
          {isImporting
            ? i18n.t("learningMode.dictionary.import.importing")
            : i18n.t("learningMode.dictionary.import.action")}
        </Button>
        <input
          id={IMPORT_INPUT_ID}
          ref={fileInputRef}
          aria-label={i18n.t("learningMode.dictionary.import.action")}
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
