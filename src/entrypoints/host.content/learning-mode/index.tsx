import type { WordCardData } from "./word-card"
import type { Config } from "@/types/config/config"
import type { LearningTier, LearningWordState } from "@/utils/learning-mode/types"
import type { WordBookRecord } from "@/utils/word-book/types"
import { browser } from "#imports"
import { isLLMProviderConfig } from "@/types/config/provider"
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
import {
  applyLearningModeCss,
  buildLearningModeCss,
  removeLearningModeCss,
} from "@/utils/learning-mode/styles"
import { startViewportScanning } from "@/utils/learning-mode/viewport-scanner"
import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { getWordInContextPrompt } from "@/utils/prompts/word-in-context"
import { urlMatchesPattern } from "@/utils/url-pattern"
import { createCardHost, createHintHost, type HintHost, type HintCounts } from "./hosts"

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

  /**
   * The AI half of the card runs on the page-translation provider: it is the
   * LLM the reader already chose for prose, and a pure translate provider
   * (Google, DeepL) simply has no word cards.
   */
  const aiProviderRow = config.providersConfig.find(
    (row) => row.id === config.pageTranslation.providerId,
  )
  const aiProvider =
    aiProviderRow && isLLMProviderConfig(aiProviderRow)
      ? { kind: "local" as const, config: aiProviderRow }
      : null
  const aiEnabled = learningConfig.ai.enabled && aiProvider !== null
  const aiTried = new Set<string>()
  let aiBudget = learningConfig.ai.maxRequestsPerPage

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
  let aiTimer: number | null = null

  /**
   * Asks for the meaning in this sentence, once per word per page. The request
   * is delayed so a pointer crossing a paragraph does not fire one per word,
   * and the reply is dropped when the reader has moved on — the card always
   * describes the word under the pointer.
   */
  const requestAi = (occurrence: MarkedOccurrence, data: WordCardData) => {
    if (!aiEnabled || aiProvider === null) return
    if (aiBudget <= 0 || aiTried.has(data.entry.w)) return
    if (!data.sentence) return

    aiTried.add(data.entry.w)
    aiBudget -= 1

    if (aiTimer !== null) window.clearTimeout(aiTimer)
    aiTimer = window.setTimeout(() => {
      aiTimer = null
      if (stopped || hovered !== occurrence) return

      const prompt = getWordInContextPrompt({
        word: data.entry.w,
        sentence: data.sentence,
        pageTitle: document.title,
        sourceLang: config.language.sourceCode === "auto" ? "eng" : config.language.sourceCode,
        targetLang: config.language.targetCode,
        langLevel: config.language.level,
      })

      card.setAi({ status: "loading" })

      void (async () => {
        try {
          const result = await sendMessage("learningWordExplain", {
            word: data.entry.w,
            sentence: data.sentence,
            providerRef: aiProvider,
            instructions: prompt.systemPrompt,
            prompt: prompt.prompt,
          })
          if (stopped || hovered !== occurrence) return
          card.setAi({ status: "ready", result })
        } catch (error) {
          logger.warn("[LearningMode] Word card request failed", error)
          if (stopped || hovered !== occurrence) return
          card.setAi({ status: "error" })
        }
      })()
    }, 350)
  }

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
    requestAi(occurrence, hoveredData)
  }

  const handlePointerLeave = (event: MouseEvent) => {
    const target = event.relatedTarget
    if (target instanceof Node && cardHostElement?.contains(target)) return
    scheduleHide()
  }

  const cardHostElement = document.getElementById("read-frog-learning-card-host")

  /**
   * Marks arrive as the reader approaches each block. The mutation and observer
   * plumbing that used to live here moved into the scanner, which owns both the
   * "scan what is near" policy and the "never judge a text node twice" set.
   */
  const scanner = startViewportScanning({
    matcher,
    highlighter,
    maxHighlights: learningConfig.maxHighlightsPerPage,
    shouldContinue,
    onProgress: refreshHint,
  })

  window.addEventListener("mousemove", handlePointerMove, { passive: true })
  document.addEventListener("mouseleave", handlePointerLeave)

  const stop = () => {
    if (stopped) return
    stopped = true
    if (aiTimer !== null) window.clearTimeout(aiTimer)
    scanner.stop()
    cancelHide()
    window.removeEventListener("mousemove", handlePointerMove)
    document.removeEventListener("mouseleave", handlePointerLeave)
    card.destroy()
    hint?.destroy()
    highlighter.reset()
    removeLearningModeCss()
  }

  logger.info("[LearningMode] Started", { entries: entries.length })

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
