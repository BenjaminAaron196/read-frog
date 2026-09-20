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

export interface CardHost {
  show(data: WordCardData, position: { x: number; y: number }, saved: boolean): void
  /** The AI half arrives after the local half, so it repaints the open card. */
  setAi(ai: WordCardAiState): void
  hide(): void
  destroy(): void
}

export interface CardHandlers {
  onSpeak(data: WordCardData): void
  onSave(data: WordCardData): void
  onKnow(data: WordCardData): void
  onIgnore(data: WordCardData): void
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
  }

  return {
    show(data, position, saved) {
      current = { data, saved }
      aiState = { status: "idle" }
      // Flip above the mark when the card would run off the bottom of the viewport.
      const estimatedHeight = 260
      const top =
        position.y + estimatedHeight > window.innerHeight
          ? Math.max(8, position.y - estimatedHeight)
          : position.y + 8
      const left = Math.min(Math.max(8, position.x), window.innerWidth - 336)
      host.element.style.left = `${left}px`
      host.element.style.top = `${top}px`
      render()
    },
    setAi(ai) {
      aiState = ai
      if (!current) return
      render()
    },
    hide() {
      if (!current) return
      current = null
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
