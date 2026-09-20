import type { CSSProperties, ReactNode } from "react"
import type { Config } from "@/types/config/config"
import type { DictionaryIndex, WordMatcher } from "@/utils/learning-mode/lookup"
import type { SubtitleToken } from "@/utils/learning-mode/subtitle-text"
import type { LearningWordState } from "@/utils/learning-mode/types"
import type { WordCardAiResult } from "@/utils/learning-mode/word-card-schema"
import { useAtomValue } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import {
  WordCard,
  type WordCardAiState,
  type WordCardData,
} from "@/entrypoints/host.content/learning-mode/word-card"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { getLocalConfig } from "@/utils/config/storage"
import {
  buildDictionaryIndex,
  collectSuppressedWords,
  createWordMatcher,
  readDictionaryEntries,
} from "@/utils/learning-mode/lookup"
import { buildSubtitleMarkCss, SUBTITLE_WORD_CLASS } from "@/utils/learning-mode/styles"
import { markSubtitleText } from "@/utils/learning-mode/subtitle-text"
import {
  requestWordExplanation,
  resolveWordCardAi,
  saveWordToBook,
  setWordState,
  speakWord,
} from "@/utils/learning-mode/word-card-actions"
import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { subtitlesSidebarOpenAtom, subtitlesStore } from "../atoms"

/**
 * The learning mode's marks, over the subtitle line.
 *
 * The page marks words with the Custom Highlight API, which cannot paint inside
 * a shadow root - and the subtitles live in one, rendered by Read Frog. So the
 * line is tokenised here and the marks are spans, styled from the same palette
 * (`buildSubtitleMarkCss`). The card behind them is the page's own card.
 */

export interface LearningSubtitleRuntime {
  mark(text: string): SubtitleToken[]
  styles: string
  /** Silences the forms the reader just marked as known or ignored. */
  suppress(words: readonly string[]): void
}

/**
 * One dictionary, one index, one matcher - for the whole document.
 *
 * The transcript renders a row per subtitle line, and every row marks its own
 * text. Reading the dictionary (tens of thousands of rows, ten megabytes) and
 * building the index per row is what froze the page: hundreds of rows, hundreds
 * of copies of one dictionary, one main thread. The load is shared, and so is
 * the answer.
 *
 * Everything the store owns is written from `ensure` (an effect) or `suppress`
 * (an event handler); components only read the snapshot it publishes, which is
 * what keeps this out of the render phase.
 */
interface SharedLearningMarks {
  mark(text: string): SubtitleToken[]
  styles: string
}

interface MarksSnapshot {
  marks: SharedLearningMarks | null
}

type LearningMarksConfig = {
  profile: Config["learningMode"]["profile"]
  display: Config["learningMode"]["display"]
}

function marksKey(learning: LearningMarksConfig): string {
  return JSON.stringify([learning.profile, learning.display])
}

class LearningMarksStore {
  private listeners = new Set<() => void>()
  private snapshot: MarksSnapshot = { marks: null }
  private key = ""
  private index: DictionaryIndex | null = null
  private states: readonly LearningWordState[] = []
  private silenced = new Set<string>()
  private loading: Promise<void> | null = null

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): MarksSnapshot => this.snapshot

  /** Loads the dictionary once, then keeps the matcher in step with the settings. */
  async ensure(learning: LearningMarksConfig): Promise<void> {
    const key = marksKey(learning)
    if (this.index === null) {
      this.loading ??= (async () => {
        try {
          const [entries, states] = await Promise.all([
            readDictionaryEntries(),
            sendMessage("learningWordStateList", undefined).catch((): LearningWordState[] => []),
          ])
          if (entries.length === 0) return
          this.index = buildDictionaryIndex(entries)
          this.states = states
        } catch (error) {
          logger.warn("[LearningMode] Subtitle marks unavailable", error)
        }
      })().finally(() => {
        this.loading = null
      })
      await this.loading
    }
    if (this.index === null || this.key === key) return
    this.key = key
    this.rebuild(learning)
  }

  /** Silences the forms the reader just marked as known or ignored. */
  suppress(learning: LearningMarksConfig, words: readonly string[]): void {
    let changed = false
    for (const word of words) {
      if (this.silenced.has(word)) continue
      this.silenced.add(word)
      changed = true
    }
    if (changed) this.rebuild(learning)
  }

  private rebuild(learning: LearningMarksConfig): void {
    if (this.index === null) return
    const matcher: WordMatcher = createWordMatcher({
      index: this.index,
      profile: learning.profile,
      suppressedWords: new Set([...collectSuppressedWords(this.states), ...this.silenced]),
    })
    this.snapshot = {
      marks: {
        mark: (text) => markSubtitleText(text, matcher),
        styles: buildSubtitleMarkCss(learning.display),
      },
    }
    for (const listener of this.listeners) listener()
  }
}

const learningMarks = new LearningMarksStore()

export function useLearningSubtitleRuntime(): LearningSubtitleRuntime | null {
  const learning = useAtomValue(configFieldsAtomMap.learningMode, { store: subtitlesStore })
  const snapshot = useSyncExternalStore(
    learningMarks.subscribe,
    learningMarks.getSnapshot,
    learningMarks.getSnapshot,
  )
  const enabled = learning.enabled

  useEffect(() => {
    if (enabled) void learningMarks.ensure(learning)
  }, [enabled, learning])

  const suppress = useCallback(
    (words: readonly string[]) => learningMarks.suppress(learning, words),
    [learning],
  )

  // The object identity is what the lines' memos watch: rebuilt only when the
  // published marks or the settings change, never on an unrelated render.
  return useMemo(() => {
    const marks = snapshot.marks
    if (!enabled || !marks) return null
    return { mark: (text: string) => marks.mark(text), styles: marks.styles, suppress }
  }, [enabled, snapshot.marks, suppress])
}

function SubtitleWord({
  token,
  onHover,
  onLeave,
  live,
}: {
  token: Extract<SubtitleToken, { kind: "word" }>
  onHover: (token: Extract<SubtitleToken, { kind: "word" }>) => void
  onLeave: () => void
  live: boolean
}) {
  if (!token.match) return <>{token.text}</>

  return (
    <span
      className={SUBTITLE_WORD_CLASS}
      data-tier={token.match.tier}
      data-rf-live={live ? "true" : undefined}
      onMouseEnter={() => onHover(token)}
      onMouseLeave={onLeave}
      // The tokens are ours, not the page's: React owns them, but the wrapper is
      // re-rendered per cue, so the hovered word carries across a re-render.
      onFocus={() => onHover(token)}
      tabIndex={-1}
      role="mark"
    >
      {token.text}
    </span>
  )
}

/**
 * Tokens keep their position in the line, which is unique even when a word
 * repeats ("the ... the"), so React can match them across cues.
 */
function tokenKeyed(tokens: SubtitleToken[]): { token: SubtitleToken; key: string }[] {
  let offset = 0
  return tokens.map((token) => {
    const key = `${offset}:${token.kind}`
    offset += token.text.length
    return { token, key }
  })
}

/**
 * The marks as inline spans, for a surface that is itself a control - the
 * transcript rows are `<button>`s, which may not contain the block wrapper the
 * subtitle line uses. The card lives with the row, not here.
 */
export function LearningText({ text }: { text: string }) {
  const runtime = useLearningSubtitleRuntime()
  const tokens = useMemo(() => (runtime ? runtime.mark(text) : null), [runtime, text])

  if (!runtime || !tokens) return <>{text}</>

  return (
    <>
      <style>{runtime.styles}</style>
      {tokenKeyed(tokens).map(({ token, key }) =>
        token.kind === "word" && token.match ? (
          <span key={key} className={SUBTITLE_WORD_CLASS} data-tier={token.match.tier}>
            {token.text}
          </span>
        ) : (
          <span key={key}>{token.text}</span>
        ),
      )}
    </>
  )
}

export interface LearningSubtitleLineProps {
  text: string
  className?: string
  style?: CSSProperties
  children?: ReactNode
}

/**
 * The subtitle line, with the profile's marks over it. Renders the plain text
 * whenever the learning mode is off or the dictionary is missing, so the line
 * never waits on the feature.
 */
export function LearningSubtitleLine({ text, className, style }: LearningSubtitleLineProps) {
  const runtime = useLearningSubtitleRuntime()
  const [hovered, setHovered] = useState<Extract<SubtitleToken, { kind: "word" }> | null>(null)
  const [saved, setSaved] = useState(false)
  const [ai, setAi] = useState<WordCardAiState>({ status: "idle" })
  const aiCache = useRef(new Map<string, WordCardAiResult | null>())
  const leaveTimer = useRef<number | null>(null)

  const tokens = useMemo(() => (runtime ? runtime.mark(text) : null), [runtime, text])

  // A cue change drops the card: the word it described is gone. Adjusted during
  // render (not in an effect) so the old card never paints over the new cue.
  const sidebarOpen = useAtomValue(subtitlesSidebarOpenAtom, { store: subtitlesStore })
  const [lastCue, setLastCue] = useState(text)
  if (lastCue !== text) {
    setLastCue(text)
    setHovered(null)
    setAi({ status: "idle" })
  }

  const cancelLeave = useCallback(() => {
    if (leaveTimer.current === null) return
    window.clearTimeout(leaveTimer.current)
    leaveTimer.current = null
  }, [])

  const scheduleLeave = useCallback(() => {
    cancelLeave()
    // Grace period so a pointer travelling from the word to the card survives.
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      setHovered(null)
      setAi({ status: "idle" })
    }, 220)
  }, [cancelLeave])

  const data: WordCardData | null = useMemo(
    () =>
      hovered?.match
        ? {
            surface: hovered.text,
            tier: hovered.match.tier,
            entry: hovered.match.entry,
            sentence: text,
          }
        : null,
    [hovered, text],
  )

  const onHover = useCallback(
    (token: Extract<SubtitleToken, { kind: "word" }>) => {
      // The sidebar covers the player: a hover that slips past its edge must not
      // open a card over the panel the reader is reading.
      if (sidebarOpen) {
        setHovered(null)
        return
      }
      cancelLeave()
      if (!token.match) return
      setHovered((previous) => {
        if (previous?.match?.entry.w === token.match?.entry.w) return previous
        setAi({ status: "idle" })
        return token
      })
    },
    [cancelLeave, sidebarOpen],
  )

  // Whether the word is already in the word book decides the card's button.
  useEffect(() => {
    const word = data?.entry.w
    if (!word) return undefined
    let cancelled = false
    void (async () => {
      const records = await sendMessage("wordBookList", undefined).catch(() => [])
      if (!cancelled) setSaved(records.some((record) => record.word.toLowerCase() === word))
    })()
    return () => {
      cancelled = true
    }
  }, [data?.entry.w])

  // The AI half, once per word, replayed from the cache afterwards.
  useEffect(() => {
    const word = data?.entry.w
    if (!word || !data) return undefined
    const cached = aiCache.current.get(word)
    if (cached !== undefined) {
      setAi({ status: "ready", result: cached })
      return undefined
    }

    let cancelled = false
    setAi({ status: "loading" })
    const timer = window.setTimeout(() => {
      void (async () => {
        // The config is read when a card is actually opening rather than held in an
        // atom: the subtitles only need it for the actions, and this keeps the
        // component free of a dependency its tests would have to mock.
        const config = await getLocalConfig()
        if (config === null) return
        const aiContext = resolveWordCardAi(config)
        if (!aiContext.enabled) return

        const result = await requestWordExplanation(
          { word, sentence: data.sentence, config, pageTitle: document.title },
          aiContext,
        )
        aiCache.current.set(word, result)
        if (!cancelled) setAi({ status: "ready", result })
      })().catch((error) => {
        logger.warn("[LearningMode] Subtitle word card request failed", error)
        if (!cancelled) setAi({ status: "error" })
      })
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [data])

  if (!runtime || !tokens) {
    return (
      <div className={className} style={style}>
        {text}
      </div>
    )
  }

  return (
    <>
      {/* The palette rides with the line so the marks are styled the moment they
          render; it sits outside the text container so the line reads as text. */}
      <style>{runtime.styles}</style>
      <div className={className} style={style}>
        {tokenKeyed(tokens).map(({ token, key }) =>
          token.kind === "word" ? (
            <SubtitleWord
              key={key}
              token={token}
              onHover={onHover}
              onLeave={scheduleLeave}
              live={hovered === token}
            />
          ) : (
            <span key={key}>{token.text}</span>
          ),
        )}

        {data ? (
          <div
            className="pointer-events-auto absolute bottom-full left-1/2 mb-2 w-max -translate-x-1/2"
            onMouseEnter={cancelLeave}
            onMouseLeave={scheduleLeave}
          >
            <WordCard
              data={data}
              saved={saved}
              ai={ai}
              onSpeak={() => {
                void (async () => {
                  const config = await getLocalConfig()
                  if (config) await speakWord(data, config)
                })()
              }}
              onSave={() => {
                void saveWordToBook(data, { url: location.href, title: document.title })
                setSaved(true)
              }}
              onKnow={() => {
                setHovered(null)
                void setWordState(data, "known").then((family) => runtime.suppress(family))
              }}
              onIgnore={() => {
                setHovered(null)
                void setWordState(data, "ignored").then((family) => runtime.suppress(family))
              }}
            />
          </div>
        ) : null}
      </div>
    </>
  )
}
