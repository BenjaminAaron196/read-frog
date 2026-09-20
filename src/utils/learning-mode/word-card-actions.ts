import type { LearningWordState } from "./types"
import type { WordCardAiResult } from "./word-card-schema"
import type { WordCardData } from "@/entrypoints/host.content/learning-mode/word-card"
import type { Config } from "@/types/config/config"
import type { PromptableProviderRef } from "@/utils/providers/provider-ref"
import { isLLMProviderConfig } from "@/types/config/provider"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { getWordInContextPrompt } from "@/utils/prompts/word-in-context"
import { collectWordFamily } from "./lookup"

/**
 * Everything a word card does, in one place.
 *
 * The page marks words with CSS highlights and the subtitles render them as
 * spans, but the card behind them is the same card: same dictionary row, same
 * actions, same AI answer. Keeping the actions here is what stops the two
 * surfaces from drifting into two behaviours.
 */

/** The dictionary's own summary line: Chinese senses first, then the English ones. */
export function describeDefinition(data: WordCardData): string {
  const chinese = data.entry.t?.slice(0, 3).join("; ")
  if (chinese) return chinese
  return data.entry.d?.slice(0, 2).join("; ") ?? ""
}

export interface WordCardAiContext {
  /** Null for a pure translate provider: those have no word cards. */
  provider: Extract<PromptableProviderRef, { kind: "local" }> | null
  enabled: boolean
}

/**
 * The AI half of the card runs on the page-translation provider: it is the LLM
 * the reader already chose for prose, and a pure translate provider (Google,
 * DeepL) simply has no word cards.
 */
export function resolveWordCardAi(config: Config): WordCardAiContext {
  const row = config.providersConfig.find(
    (candidate) => candidate.id === config.pageTranslation.providerId,
  )
  if (!row || !isLLMProviderConfig(row)) return { provider: null, enabled: false }
  return { provider: { kind: "local", config: row }, enabled: true }
}

/** The reader's TTS settings are for whole passages; a word wants the English voice. */
export async function speakWord(data: WordCardData, config: Config): Promise<void> {
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

export interface WordCardSource {
  /** Where the reader met the word, for the word book entry. */
  url: string
  title: string
}

export async function saveWordToBook(data: WordCardData, source: WordCardSource): Promise<void> {
  await sendMessage("wordBookAdd", {
    word: data.entry.w,
    definition: describeDefinition(data),
    context: data.sentence,
    sourceUrl: source.url,
    sourceTitle: source.title,
  }).catch((error) => logger.warn("[LearningMode] Saving the word failed", error))
}

/**
 * Records "known" or "ignored" and reports the forms it silences: only a verdict
 * that silences a mark spreads across the family, because a reader who knows
 * `perceive` also knows `perceived`.
 */
export async function setWordState(
  data: WordCardData,
  state: Extract<LearningWordState["state"], "known" | "ignored">,
): Promise<string[]> {
  const family = collectWordFamily(data.entry)
  await sendMessage("learningWordStateSet", {
    word: data.entry.w,
    state,
    family,
  }).catch((error) => logger.warn("[LearningMode] Saving the word state failed", error))
  return family
}

export interface WordExplanationRequest {
  word: string
  sentence: string
  config: Config
  pageTitle: string
}

/** The contextual explanation, as the card's AI half. */
export async function requestWordExplanation(
  request: WordExplanationRequest,
  ai: WordCardAiContext,
): Promise<WordCardAiResult | null> {
  if (!ai.enabled || ai.provider === null) return null

  const prompt = getWordInContextPrompt({
    word: request.word,
    sentence: request.sentence,
    pageTitle: request.pageTitle,
    sourceLang:
      request.config.language.sourceCode === "auto" ? "eng" : request.config.language.sourceCode,
    targetLang: request.config.language.targetCode,
    langLevel: request.config.language.level,
  })

  return sendMessage("learningWordExplain", {
    word: request.word,
    sentence: request.sentence,
    providerRef: ai.provider,
    instructions: prompt.systemPrompt,
    prompt: prompt.prompt,
  })
}
