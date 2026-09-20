import type { WordCardData } from "./word-card"
import type { Config } from "@/types/config/config"
import type { LearningTier, LearningWordState } from "@/utils/learning-mode/types"
import type { WordCardAiResult } from "@/utils/learning-mode/word-card-schema"
import type { WordBookRecord } from "@/utils/word-book/types"
import { browser } from "#imports"
import { isLLMProviderConfig } from "@/types/config/provider"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { LearningHighlighter, type MarkedOccurrence } from "@/utils/learning-mode/highlighter"
import {
  createHoverIntent,
  decideHover,
  HOVER_SWITCH_DELAY_MS,
  type HoverIntent,
} from "@/utils/learning-mode/hover-intent"
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
import {
  createCardHost,
  createHintHost,
  type CardAnchor,
  type HintHost,
  type HintCounts,
} from "./hosts"

/** The pointer moves far more often than the hovered mark changes. */
const HOVER_THROTTLE_MS = 60
/**
 * The word under a still pointer can still move: animated banners slide text
 * under it, and those animations fire no scroll event. While a card is open its
 * mark is re-measured on this cadence so the card cannot drift away from it.
 */
const ANCHOR_WATCH_MS = 200
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
  /**
   * One answer per word per page, replayed to the card on every later hover.
   * Requesting it again would be a wasted round trip, and not showing it would
   * make the same word look like it lost its explanation.
   */
  const aiResults = new Map<string, WordCardAiResult | null>()
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
  /** Headword the open card describes; the AI reply is matched against it. */
  let hoveredWord: string | null = null
  let hoverIntent: HoverIntent = createHoverIntent()
  let aiTimer: number | null = null

  /**
   * Asks for the meaning in this sentence, once per word per page. The request
   * is delayed so a pointer crossing a paragraph does not fire one per word,
   * and the reply is dropped when the reader has moved on — the card always
   * describes the word under the pointer.
   */
  const requestAi = (word: string, data: WordCardData) => {
    if (aiResults.has(word)) {
      card.setAi({ status: "ready", result: aiResults.get(word) ?? null })
      return
    }
    if (!aiEnabled || aiProvider === null) return
    if (aiBudget <= 0) return
    if (!data.sentence) return

    aiBudget -= 1

    if (aiTimer !== null) window.clearTimeout(aiTimer)
    aiTimer = window.setTimeout(() => {
      aiTimer = null
      if (stopped || hoveredWord !== word) return

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
          aiResults.set(word, result)
          if (stopped || hoveredWord !== word) return
          card.setAi({ status: "ready", result })
        } catch (error) {
          logger.warn("[LearningMode] Word card request failed", error)
          if (stopped || hoveredWord !== word) return
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

  let lastPosition: CardAnchor = { x: 0, y: 0, wordRect: { left: 0, top: 0, right: 0, bottom: 0 } }
  let lastPointer = { x: 0, y: 0 }
  let hideTimer: number | null = null
  let candidateTimer: number | null = null
  let anchorWatch: number | null = null
  let lastMoveAt = 0

  const cancelHide = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  const stopAnchorWatch = () => {
    if (anchorWatch === null) return
    window.clearInterval(anchorWatch)
    anchorWatch = null
  }

  const hideCard = () => {
    cancelHide()
    stopAnchorWatch()
    highlighter.setHovered(null)
    hovered = null
    hoveredWord = null
    hoverIntent = createHoverIntent()
    if (candidateTimer !== null) {
      window.clearTimeout(candidateTimer)
      candidateTimer = null
    }
    card.hide()
  }

  const scheduleHide = () => {
    cancelHide()
    hideTimer = window.setTimeout(hideCard, CARD_HIDE_DELAY_MS)
  }

  const anchorOf = (occurrence: MarkedOccurrence): CardAnchor => {
    const rect = occurrence.range.getBoundingClientRect()
    return {
      x: rect.left,
      y: rect.bottom,
      wordRect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    }
  }

  /** Follows the mark the card belongs to, and gives up when it is gone. */
  const watchAnchor = () => {
    if (!hovered) return
    const rect = hovered.range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      hideCard()
      return
    }
    if (
      Math.abs(rect.left - lastPosition.wordRect.left) < 1 &&
      Math.abs(rect.top - lastPosition.wordRect.top) < 1
    ) {
      return
    }
    lastPosition = anchorOf(hovered)
    card.reposition(lastPosition)
    observePointer(lastPointer.x, lastPointer.y)
  }

  const openCard = (occurrence: MarkedOccurrence) => {
    cancelHide()
    const data = cardDataOf(occurrence)
    const previousId = hovered?.id ?? null
    const wasOpen = card.isVisible()
    hovered = occurrence
    hoveredWord = data.entry.w
    highlighter.setHovered(occurrence)

    // Every mark owns its own position: the same word appears many times on a
    // page, and the card belongs to the copy under the pointer.
    if (!wasOpen || previousId !== occurrence.id) {
      lastPosition = anchorOf(occurrence)
    }
    if (anchorWatch === null) anchorWatch = window.setInterval(watchAnchor, ANCHOR_WATCH_MS)
    card.show(data, lastPosition, savedWords.has(data.entry.w))
    requestAi(data.entry.w, data)
  }

  const isPointInsideCurrentRect = (x: number, y: number): boolean => {
    if (!hovered) return false
    try {
      const rect = hovered.range.getBoundingClientRect()
      const margin = 6
      return (
        x >= rect.left - margin &&
        x <= rect.right + margin &&
        y >= rect.top - margin &&
        y <= rect.bottom + margin
      )
    } catch {
      return false
    }
  }

  /**
   * One decision per pointer observation, fed through the intent machine
   * (`utils/learning-mode/hover-intent.ts`): the caret is noisy at word edges and
   * over the card, so the card only moves once a different word has clearly been
   * under the pointer, and it never disappears while the pointer is on it.
   */
  const containsPoint = (rect: DOMRect, x: number, y: number, margin = 4): boolean =>
    x >= rect.left - margin &&
    x <= rect.right + margin &&
    y >= rect.top - margin &&
    y <= rect.bottom + margin

  /**
   * The mark the pointer is on. The caret is cheap and usually right; inside an
   * animated subtree it answers in layout space and can name a sibling copy of
   * the same text, so its answer is only trusted when the mark's own box covers
   * the pointer.
   */
  const resolveOccurrence = (
    x: number,
    y: number,
    caret: { node: Node; offset: number } | null,
  ): MarkedOccurrence | null => {
    const fromCaret = caret ? highlighter.hitTest(caret.node, caret.offset) : null
    if (fromCaret && containsPoint(fromCaret.range.getBoundingClientRect(), x, y)) {
      return fromCaret
    }
    if (!caret) return null
    return highlighter.hitTestPoint(x, y)
  }

  const observePointer = (x: number, y: number) => {
    const now = performance.now()
    lastMoveAt = now
    lastPointer = { x, y }

    const overCard = card.isPointerOverPoint(x, y)
    const caret = overCard ? null : caretAtPoint(x, y)
    const occurrence = overCard ? null : resolveOccurrence(x, y, caret)

    const decision = decideHover(hoverIntent, {
      occurrenceId: occurrence?.id ?? null,
      now,
      isPointerOverCard: overCard,
      isWithinOpenWordRect: isPointInsideCurrentRect(x, y),
    })
    hoverIntent = decision.intent
    if (decision.action === "keep") {
      cancelHide()
      // A pointer that lands on a new word and then stops still has to switch:
      // observations arrive only on movement, so the wait is finished by a timer
      // that re-reads the caret where the pointer already is.
      if (hoverIntent.candidateId !== null) {
        scheduleCandidateCheck(HOVER_SWITCH_DELAY_MS - (now - hoverIntent.candidateSince))
      }
      return
    }
    if (decision.action === "hide") {
      scheduleHide()
      return
    }
    if (occurrence) openCard(occurrence)
  }

  const handlePointerMove = (event: MouseEvent) => {
    if (performance.now() - lastMoveAt < HOVER_THROTTLE_MS) return
    observePointer(event.clientX, event.clientY)
  }

  const scheduleCandidateCheck = (delayMs: number) => {
    if (candidateTimer !== null) window.clearTimeout(candidateTimer)
    candidateTimer = window.setTimeout(
      () => {
        candidateTimer = null
        if (stopped || hoverIntent.candidateId === null) return
        observePointer(lastPointer.x, lastPointer.y)
      },
      Math.max(20, delayMs),
    )
  }

  const handlePointerLeave = (event: MouseEvent) => {
    if (card.isPointerOver(event)) return
    scheduleHide()
  }

  /** The card is anchored to a rect that moves with the page, so a scroll ends it. */
  const handleScroll = () => {
    if (hovered) hideCard()
  }

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
  window.addEventListener("scroll", handleScroll, { passive: true, capture: true })

  const stop = () => {
    if (stopped) return
    stopped = true
    if (aiTimer !== null) window.clearTimeout(aiTimer)
    if (candidateTimer !== null) window.clearTimeout(candidateTimer)
    stopAnchorWatch()
    scanner.stop()
    cancelHide()
    window.removeEventListener("mousemove", handlePointerMove)
    document.removeEventListener("mouseleave", handlePointerLeave)
    window.removeEventListener("scroll", handleScroll, { capture: true })
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
