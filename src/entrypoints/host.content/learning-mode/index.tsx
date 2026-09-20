import type { WordCardData } from "./word-card"
import type { Config } from "@/types/config/config"
import type { LearningTier, LearningWordState } from "@/utils/learning-mode/types"
import type { WordBookRecord } from "@/utils/word-book/types"
import { browser } from "#imports"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { LearningHighlighter, type MarkedOccurrence } from "@/utils/learning-mode/highlighter"
import {
  buildDictionaryIndex,
  collectSuppressedWords,
  collectWordFamily,
  createWordMatcher,
  readDictionaryEntries,
  readDictionaryMeta,
} from "@/utils/learning-mode/lookup"
import { scanTextNodes } from "@/utils/learning-mode/scanner"
import {
  applyLearningModeCss,
  buildLearningModeCss,
  removeLearningModeCss,
} from "@/utils/learning-mode/styles"
import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { urlMatchesPattern } from "@/utils/url-pattern"
import { createCardHost, createHintHost, type HintHost, type HintCounts } from "./hosts"

/** Page changes arrive in bursts; one scan per burst is enough. */
const RESCAN_DEBOUNCE_MS = 400
/** The pointer moves far more often than the hovered mark changes. */
const HOVER_THROTTLE_MS = 60
/** Grace period so the card survives the pointer travelling from the word to it. */
const CARD_HIDE_DELAY_MS = 220

function countByTier(occurrences: readonly MarkedOccurrence[]): HintCounts {
  const byTier: Record<LearningTier, number> = { tier1: 0, tier2: 0, tier3: 0 }
  for (const occurrence of occurrences) {
    byTier[occurrence.tier] += 1
  }
  return { total: occurrences.length, byTier }
}

/** Caret hit-testing across engines: Firefox exposes the standard API, Chromium the legacy one. */
function caretAtPoint(x: number, y: number): { node: Node; offset: number } | null {
  const position = document.caretPositionFromPoint?.(x, y)
  if (position?.offsetNode) {
    return { node: position.offsetNode, offset: position.offset }
  }
  const legacy = document.caretRangeFromPoint?.(x, y)
  if (legacy) {
    return { node: legacy.startContainer, offset: legacy.startOffset }
  }
  return null
}

/** Where the density chip belongs: the page's own content root, when it has one. */
function findContentAnchor(): Element | null {
  return document.querySelector("article, main, #content, .content")
}

function describeDefinition(data: WordCardData): string {
  const chinese = data.entry.t?.slice(0, 3).join("; ")
  if (chinese) return chinese
  return data.entry.d?.slice(0, 2).join("; ") ?? ""
}

export interface LearningModeRuntime {
  /** Number of marks currently on the page, for tests and diagnostics. */
  markCount(): number
  stop(): void
}

/**
 * Boots the learning mode for one page: loads the dictionary the reader
 * imported, marks every word above their level, and wires the hover card.
 *
 * Returns `null` when the feature cannot run — disabled, excluded for this site,
 * or no dictionary imported — because "nothing happened" is the correct outcome
 * in all three cases and none of them should look like an error.
 */
export async function startLearningMode(config: Config): Promise<LearningModeRuntime | null> {
  const learningConfig = config.learningMode
  if (!learningConfig.enabled) return null

  if (
    learningConfig.excludedPatterns.some((pattern) =>
      urlMatchesPattern(window.location.href, pattern),
    )
  ) {
    return null
  }

  const meta = await readDictionaryMeta()
  if (!meta) {
    logger.info("[LearningMode] No dictionary imported; skipping")
    return null
  }

  const entries = await readDictionaryEntries()
  if (entries.length === 0) {
    logger.info("[LearningMode] Dictionary is empty; skipping")
    return null
  }

  const [states, savedRecords] = await Promise.all([
    sendMessage("learningWordStateList", undefined).catch((): LearningWordState[] => []),
    sendMessage("wordBookList", undefined).catch((): WordBookRecord[] => []),
  ])

  const index = buildDictionaryIndex(entries)
  const suppressed = collectSuppressedWords(states)
  const savedWords = new Set(savedRecords.map((record) => record.word.toLowerCase()))
  const highlighter = new LearningHighlighter()
  const matcher = createWordMatcher({
    index,
    profile: learningConfig.profile,
    suppressedWords: suppressed,
  })

  applyLearningModeCss(buildLearningModeCss(learningConfig.display))
  highlighter.setSavedWords(savedWords)

  let stopped = false
  const shouldContinue = () => !stopped

  // The card renders the same row the mark does, so it is built from the mark.
  const cardDataOf = (occurrence: MarkedOccurrence): WordCardData => ({
    surface: occurrence.surface,
    tier: occurrence.tier,
    entry: occurrence.entry,
    sentence: occurrence.sentence,
  })

  let hintHidden = !learningConfig.display.showDensityHint
  let hint: HintHost | null = null
  const refreshHint = () => {
    if (hintHidden) return
    if (!hint) {
      hint = createHintHost(findContentAnchor(), () => {
        hintHidden = true
        hint?.destroy()
        hint = null
      })
    }
    hint.update(countByTier(highlighter.occurrencesSnapshot))
  }

  const removeMarks = (occurrence: MarkedOccurrence) => {
    highlighter.flashKnown(occurrence)
    window.setTimeout(() => {
      highlighter.clearKnownFlash()
      highlighter.removeOccurrencesOf(occurrence.entry)
      highlighter.commit()
      refreshHint()
    }, 320)
  }

  const speak = async (data: WordCardData) => {
    // The reader's TTS settings are for whole passages; a word wants the English
    // voice specifically, so a Chinese-configured default does not mispronounce it.
    const voice = config.tts.languageVoices.eng ?? config.tts.defaultVoice
    const signed = (value: number, unit: "%" | "Hz") => `${value >= 0 ? "+" : ""}${value}${unit}`
    const result = await sendMessage("edgeTtsSynthesize", {
      text: data.surface,
      voice,
      rate: signed(config.tts.rate, "%"),
      pitch: signed(config.tts.pitch, "Hz"),
      volume: signed(config.tts.volume, "%"),
    }).catch(() => null)
    if (!result?.ok) return

    await sendMessage("ttsPlaybackPrepare", undefined).catch(() => undefined)
    await sendMessage("ttsPlaybackStart", {
      requestId: getRandomUUID(),
      audioBase64: result.audioBase64,
      contentType: result.contentType,
    }).catch(() => undefined)
  }

  const saveToWordBook = async (data: WordCardData) => {
    await sendMessage("wordBookAdd", {
      word: data.entry.w,
      definition: describeDefinition(data),
      context: data.sentence,
      sourceUrl: window.location.href,
      sourceTitle: document.title,
    }).catch((error) => logger.warn("[LearningMode] Saving the word failed", error))

    savedWords.add(data.entry.w)
    highlighter.setSavedWords(savedWords)
    highlighter.commit()
    card.show(data, lastPosition, true)
  }

  const setWordState = async (
    data: WordCardData,
    state: "known" | "ignored",
    occurrence: MarkedOccurrence,
  ) => {
    const family = collectWordFamily(data.entry)
    for (const form of family) suppressed.add(form)
    await sendMessage("learningWordStateSet", {
      word: data.entry.w,
      state,
      family,
    }).catch((error) => logger.warn("[LearningMode] Saving the word state failed", error))
    removeMarks(occurrence)
  }

  let hovered: MarkedOccurrence | null = null
  let hoveredData: WordCardData | null = null

  const card = createCardHost({
    onSpeak: (data) => void speak(data),
    onSave: (data) => void saveToWordBook(data),
    onKnow: (data) => {
      if (hovered) void setWordState(data, "known", hovered)
      card.hide()
    },
    onIgnore: (data) => {
      if (hovered) void setWordState(data, "ignored", hovered)
      card.hide()
    },
  })

  let lastPosition = { x: 0, y: 0 }
  let hideTimer: number | null = null
  let lastMoveAt = 0

  const cancelHide = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  const scheduleHide = () => {
    cancelHide()
    hideTimer = window.setTimeout(() => {
      highlighter.setHovered(null)
      hovered = null
      hoveredData = null
      card.hide()
    }, CARD_HIDE_DELAY_MS)
  }

  const handlePointerMove = (event: MouseEvent) => {
    const now = performance.now()
    if (now - lastMoveAt < HOVER_THROTTLE_MS) return
    lastMoveAt = now

    const caret = caretAtPoint(event.clientX, event.clientY)
    if (!caret) {
      scheduleHide()
      return
    }

    const occurrence = highlighter.hitTest(caret.node, caret.offset)
    if (!occurrence) {
      scheduleHide()
      return
    }

    cancelHide()
    if (occurrence === hovered) return

    hovered = occurrence
    hoveredData = cardDataOf(occurrence)
    highlighter.setHovered(occurrence)
    const rect = occurrence.range.getBoundingClientRect()
    lastPosition = { x: rect.left, y: rect.bottom }
    card.show(hoveredData, lastPosition, savedWords.has(hoveredData.entry.w))
  }

  const handlePointerLeave = (event: MouseEvent) => {
    const target = event.relatedTarget
    if (target instanceof Node && cardHostElement?.contains(target)) return
    scheduleHide()
  }

  const cardHostElement = document.getElementById("read-frog-learning-card-host")

  // The scan and the page's own churn share one queue: a rescan waits for the
  // previous one, so a fast SPA cannot stack scans on top of each other.
  let scanChain: Promise<void> = Promise.resolve()
  const enqueueScan = (roots: ParentNode[]) => {
    scanChain = scanChain.then(async () => {
      if (stopped) return
      for (const root of roots) {
        if (root instanceof Element && root.id.startsWith("read-frog")) continue
        await scanTextNodes(root, {
          matcher,
          highlighter,
          maxHighlights: learningConfig.maxHighlightsPerPage,
          shouldContinue,
        })
      }
      highlighter.commit()
      refreshHint()
    })
  }

  enqueueScan([document.body])
  await scanChain

  const pendingRoots = new Set<Element>()
  let rescanTimer: number | null = null
  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof HTMLElement) pendingRoots.add(node)
      }
    }
    if (pendingRoots.size === 0) return
    if (rescanTimer !== null) window.clearTimeout(rescanTimer)
    rescanTimer = window.setTimeout(() => {
      const roots = [...pendingRoots]
      pendingRoots.clear()
      rescanTimer = null
      enqueueScan(roots)
    }, RESCAN_DEBOUNCE_MS)
  })

  mutations.observe(document.body, { childList: true, subtree: true })
  window.addEventListener("mousemove", handlePointerMove, { passive: true })
  document.addEventListener("mouseleave", handlePointerLeave)

  const stop = () => {
    if (stopped) return
    stopped = true
    mutations.disconnect()
    if (rescanTimer !== null) window.clearTimeout(rescanTimer)
    cancelHide()
    window.removeEventListener("mousemove", handlePointerMove)
    document.removeEventListener("mouseleave", handlePointerLeave)
    card.destroy()
    hint?.destroy()
    highlighter.reset()
    removeLearningModeCss()
  }

  logger.info("[LearningMode] Started", { entries: entries.length, marks: highlighter.count })

  return {
    markCount: () => highlighter.count,
    stop,
  }
}

/** Dictionary or settings changes rebuild the whole run; the page state is cheap to redo. */
export function watchLearningModeStorage(onChange: () => void): () => void {
  const listener = (changes: Record<string, unknown>, areaName: string) => {
    if (areaName !== "local") return
    if (Object.keys(changes).length === 0) return
    onChange()
  }

  browser.storage.onChanged.addListener(listener)
  return () => browser.storage.onChanged.removeListener(listener)
}
