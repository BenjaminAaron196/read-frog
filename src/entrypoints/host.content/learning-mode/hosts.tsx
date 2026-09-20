import type { LearningTier } from "@/utils/learning-mode/types"
import ReactDOM from "react-dom/client"
import themeCSS from "@/assets/styles/theme.css?inline"
import { NOTRANSLATE_CLASS, REACT_SHADOW_HOST_CLASS } from "@/utils/constants/dom-labels"
import { i18n } from "@/utils/i18n"
import { LocaleBoundary } from "@/utils/i18n/locale-boundary"
import { ShadowHostBuilder } from "@/utils/react-shadow-host/shadow-host-builder"
import { WordCard, type WordCardAiState, type WordCardData } from "./word-card"

/**
 * Both surfaces live in their own shadow hosts: the page's styles cannot reach
 * them, and `read-frog-react-shadow-host` keeps them out of the page
 * translation's walk (see `utils/host/dom/filter.ts`).
 */
const HOST_Z_INDEX = 2147483000

function createHost(
  hostId: string,
  position: "block" | "inline",
): {
  element: HTMLElement
  root: ReactDOM.Root
  cleanup: () => void
} {
  const shadowHost = document.createElement("div")
  shadowHost.id = hostId
  shadowHost.classList.add(REACT_SHADOW_HOST_CLASS)
  const shadowRoot = shadowHost.attachShadow({ mode: "open" })
  const hostBuilder = new ShadowHostBuilder(shadowRoot, {
    position,
    cssContent: [themeCSS],
    inheritStyles: false,
  })
  const container = hostBuilder.build()
  const root = ReactDOM.createRoot(container)

  return {
    element: shadowHost,
    root,
    cleanup: () => hostBuilder.cleanup(),
  }
}

/** Where the card goes: the word's own box, so it can never be covered. */
export interface CardAnchor {
  x: number
  y: number
  wordRect: { left: number; top: number; right: number; bottom: number }
}

export interface CardHost {
  show(data: WordCardData, position: CardAnchor, saved: boolean): void
  /** The AI half arrives after the local half, so it repaints the open card. */
  setAi(ai: WordCardAiState): void
  /** True when the event came from inside the card (its own buttons included). */
  isPointerOver(event: Event): boolean
  /** Same question asked by position, for callers that have no event at hand. */
  isPointerOverPoint(x: number, y: number): boolean
  /** Whether a card is on screen right now. */
  isVisible(): boolean
  hide(): void
  destroy(): void
}

export interface CardHandlers {
  onSpeak(data: WordCardData): void
  onSave(data: WordCardData): void
  onKnow(data: WordCardData): void
  onIgnore(data: WordCardData): void
}

const CARD_MARGIN = 8
/** Distance between the card and the word it describes. */
const CARD_GAP = 8

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * How deeply two boxes collide on their shallowest axis, 0 when they are apart.
 * Ranking sides by penetration (rather than by "does it touch") keeps the choice
 * meaningful when every side is crowded: the least buried one wins.
 */
function penetration(a: Box, b: Box): number {
  const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return x > 0 && y > 0 ? Math.min(x, y) : 0
}

/**
 * Wikipedia's own link previews ("Page Previews"). They appear next to the same
 * links the reader hovers, a moment after the pointer lands, so the card has to
 * step aside rather than land on top of them.
 */
function previewObstacle(): Box | null {
  let union: Box | null = null
  for (const element of document.querySelectorAll(".mwe-popups, #mwe-popups-svg")) {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    union = union
      ? {
          left: Math.min(union.left, rect.left),
          top: Math.min(union.top, rect.top),
          right: Math.max(union.right, rect.right),
          bottom: Math.max(union.bottom, rect.bottom),
        }
      : { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
  }
  return union
}

/**
 * The hover card is one React root that is re-rendered with whatever mark the
 * pointer is over, rather than one root per word: a page can carry thousands of
 * marks, and only one card can be open.
 */
export function createCardHost(handlers: CardHandlers): CardHost {
  const host = createHost("read-frog-learning-card-host", "block")
  host.element.style.cssText = `position: fixed; z-index: ${HOST_Z_INDEX}; pointer-events: auto;`
  document.body.appendChild(host.element)

  let current: { data: WordCardData; saved: boolean } | null = null
  let aiState: WordCardAiState = { status: "idle" }
  /** Where the card belongs relative to the word it describes. */
  let anchor: CardAnchor | null = null
  let placeTimers: number[] = []
  let sizeObserver: ResizeObserver | undefined

  const place = () => {
    if (!anchor) return
    // Measured, not estimated: the card grows when the answer for the sentence
    // and the AI half land, and a guessed height would leave it sitting over the
    // word it describes.
    const box = host.element.getBoundingClientRect()
    const width = box.width
    const height = box.height
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const word = anchor.wordRect
    const obstacle = previewObstacle()

    const candidate = (left_: number, top: number): Box => {
      // Each side is clamped on its own: clamping once, after the choice, would
      // drag a card that belongs beside the word back under it.
      const left = Math.min(
        Math.max(CARD_MARGIN, left_),
        Math.max(CARD_MARGIN, viewport.width - width - CARD_MARGIN),
      )
      return { left, top, right: left + width, bottom: top + height }
    }
    const onScreen = (box_: Box) =>
      box_.left >= CARD_MARGIN &&
      box_.right + CARD_MARGIN <= viewport.width &&
      box_.top >= CARD_MARGIN &&
      box_.bottom + CARD_MARGIN <= viewport.height

    // Beside the word first (the page's own previews do the same, and it leaves
    // the lines below the word reachable), then below it, then above it. Each
    // side is measured from the word's own box, so none of them can land on the
    // word the card is describing.
    const ranked = [
      candidate(word.right + CARD_GAP, word.top),
      candidate(anchor.x, anchor.y + CARD_GAP),
      candidate(anchor.x, word.top - height - CARD_GAP),
    ].map((box_) => ({
      box: box_,
      offScreen: onScreen(box_) ? 0 : 1,
      onObstacle: obstacle ? penetration(box_, obstacle) : 0,
      onWord: penetration(box_, word),
    }))
    // Stable sort, so sides that are equally good keep the preferred order.
    ranked.sort(
      (a, b) => a.offScreen - b.offScreen || a.onObstacle - b.onObstacle || a.onWord - b.onWord,
    )
    const chosen = ranked[0]?.box ?? candidate(anchor.x, anchor.y + CARD_GAP)
    const top = Math.min(
      Math.max(CARD_MARGIN, chosen.top),
      Math.max(CARD_MARGIN, viewport.height - height - CARD_MARGIN),
    )
    host.element.style.left = `${chosen.left}px`
    host.element.style.top = `${top}px`
  }

  /** Placement has to survive content that lands late (answers, images, fonts). */
  if (typeof ResizeObserver !== "undefined") {
    sizeObserver = new ResizeObserver(() => place())
    sizeObserver.observe(host.element)
  }

  const render = () => {
    if (!current) {
      host.root.render(null)
      return
    }
    const { data, saved } = current
    host.root.render(
      <LocaleBoundary>
        <div className={NOTRANSLATE_CLASS}>
          <WordCard
            data={data}
            saved={saved}
            ai={aiState}
            onSpeak={() => handlers.onSpeak(data)}
            onSave={() => handlers.onSave(data)}
            onKnow={() => handlers.onKnow(data)}
            onIgnore={() => handlers.onIgnore(data)}
          />
        </div>
      </LocaleBoundary>,
    )
    // The card's height is only known after React commits; the next frame then
    // places it from that real height.
    requestAnimationFrame(place)
  }

  return {
    show(data, position, saved) {
      const isSameMark =
        current?.data.entry.w === data.entry.w &&
        anchor?.x === position.x &&
        anchor?.y === position.y
      current = { data, saved }
      // The caller decides when the card moves (it knows the mark under the
      // pointer); a repaint of the same mark keeps the AI half that is already
      // on screen instead of dropping back to a spinner.
      if (!isSameMark) aiState = { status: "idle" }
      anchor = position
      render()
      // Wikipedia's previews show up a moment after the pointer stops, so the
      // placement is re-checked once they have had their chance to appear.
      for (const timer of placeTimers) window.clearTimeout(timer)
      placeTimers = [window.setTimeout(place, 350), window.setTimeout(place, 900)]
    },
    setAi(ai) {
      aiState = ai
      if (!current) return
      render()
    },
    isPointerOver(event) {
      return event.composedPath().includes(host.element)
    },
    isPointerOverPoint(x, y) {
      const hit = document.elementFromPoint(x, y)
      return hit === host.element || (hit !== null && host.element.contains(hit))
    },
    isVisible() {
      return current !== null
    },
    hide() {
      for (const timer of placeTimers) window.clearTimeout(timer)
      placeTimers = []
      if (!current) return
      current = null
      anchor = null
      aiState = { status: "idle" }
      render()
    },
    destroy() {
      current = null
      host.root.unmount()
      host.cleanup()
      host.element.remove()
    },
  }
}

export interface HintCounts {
  total: number
  byTier: Record<LearningTier, number>
}

export interface HintHost {
  update(counts: HintCounts): void
  destroy(): void
}

/**
 * The page-density chip. It is inserted where the article starts rather than
 * pinned to the viewport: the count is article-level information, and a fixed
 * badge would sit over the page's own controls.
 */
export function createHintHost(anchor: Element | null, onHide: () => void): HintHost {
  const host = createHost("read-frog-learning-hint-host", "inline")
  const wrapper = document.createElement("div")
  wrapper.className = NOTRANSLATE_CLASS
  wrapper.style.cssText = `margin: 8px 0 12px; z-index: ${HOST_Z_INDEX};`
  wrapper.appendChild(host.element)

  const target = anchor ?? document.body
  target.insertAdjacentElement("afterbegin", wrapper)

  return {
    update(counts) {
      host.root.render(
        <LocaleBoundary>
          <div className={NOTRANSLATE_CLASS}>
            <div className="inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
              <span>{i18n.t("learningMode.hint.summary", [String(counts.total)])}</span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="size-2 rounded-full bg-indigo-500/70"
                  title={i18n.t("learningMode.tier.nudge")}
                />
                <span>{counts.byTier.tier1}</span>
                <span
                  className="size-2 rounded-full bg-amber-500/80"
                  title={i18n.t("learningMode.tier.hard")}
                />
                <span>{counts.byTier.tier2}</span>
                <span
                  className="size-2 rounded-full bg-rose-500/80"
                  title={i18n.t("learningMode.tier.beyond")}
                />
                <span>{counts.byTier.tier3}</span>
              </span>
              <button
                type="button"
                onClick={onHide}
                className="rounded-md px-1 text-[11px] hover:bg-accent hover:text-foreground"
              >
                {i18n.t("learningMode.hint.hide")}
              </button>
            </div>
          </div>
        </LocaleBoundary>,
      )
    },
    destroy() {
      host.root.unmount()
      host.cleanup()
      wrapper.remove()
    },
  }
}
