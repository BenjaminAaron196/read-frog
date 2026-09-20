import type { LearningHighlighter } from "./highlighter"
import type { WordMatcher } from "./lookup"
import { TRANSLATED_CONTENT_CLASSES } from "@/utils/constants/dom-labels"
import { scanTextNodes } from "./scanner"

/**
 * Marks arrive as the reader approaches the text, never as one full-page pass.
 * A vocabulary-dense article carries thousands of candidate words, and judging
 * all of them up front (plus building a `Range` and a card entry for each) is
 * exactly the main-thread spike this avoids: the run only ever touches what is
 * on screen or about to be.
 */

/** Blocks looked at ahead of the reader: about a screen and a half of margin. */
const SCAN_MARGIN = "1200px 0px"

/**
 * The elements worth looking at. `div` is here because sites disagree about what
 * a paragraph is: Reuters renders the article body as `<div
 * data-testid="paragraph">`, and plenty of others use plain divs, so a selector
 * without it silently marks the page furniture and nothing else.
 *
 * Watching a div is not the same as scanning it: `isReadingUnit` keeps the
 * containers out, so only a div that holds the text itself is ever walked.
 */
const CONTENT_BLOCK_SELECTOR = [
  "p",
  "li",
  "dd",
  "dt",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "figcaption",
  "div",
].join(",")

/**
 * Elements that make a div a container rather than a paragraph. A container
 * would drag its whole subtree into one scan, which is the full-page pass this
 * module exists to avoid, so a div holding any of these is skipped.
 */
const NESTED_BLOCK_SELECTOR = [
  "p",
  "div",
  "li",
  "ul",
  "ol",
  "dl",
  "section",
  "article",
  "aside",
  "table",
  "figure",
  "blockquote",
  "pre",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
].join(",")

/**
 * Custom elements that hold prose: `<yt-attributed-string>` renders a YouTube
 * comment, and sites that ship their own paragraph element look the same to us -
 * a hyphenated tag whose text is its own.
 */
function isCustomElement(element: Element): boolean {
  return element.tagName.includes("-")
}

/**
 * Every element worth watching: the reading blocks, plus the custom elements
 * inside them.
 *
 * The custom elements used to be found by scanning every element in the
 * document, which on a large article is tens of thousands of nodes touched
 * before a single word is marked. A custom element that holds prose sits inside
 * the blocks we already look at, so the discovery is bounded by them.
 */
function collectCandidates(): Element[] {
  const blocks = [...document.querySelectorAll(CONTENT_BLOCK_SELECTOR)]
  const custom: Element[] = []
  for (const block of blocks) {
    for (const element of block.querySelectorAll("*")) {
      if (isCustomElement(element)) custom.push(element)
    }
  }
  return custom.length === 0 ? blocks : [...blocks, ...custom]
}

/** Whether an element is a reading unit: a block, or a container that is its own text. */
function isReadingUnit(element: Element): boolean {
  if (element.tagName === "DIV" || isCustomElement(element)) {
    return element.querySelector(NESTED_BLOCK_SELECTOR) === null
  }
  return true
}

export interface ViewportScannerOptions {
  matcher: WordMatcher
  highlighter: LearningHighlighter
  maxHighlights: number
  shouldContinue: () => boolean
  /** Called after every batch so the density hint can follow along. */
  onProgress?: () => void
}

export interface ViewportScanner {
  /** Text nodes judged so far. */
  scannedNodes(): number
  /** True once the per-page mark cap stopped the run. */
  capped(): boolean
  stop(): void
}

/**
 * Watches the content blocks around the viewport and scans each one once, on
 * approach. `visited` is shared with every scan so a block that was already
 * judged (or re-judged after a mutation) never adds its marks twice.
 */
export function startViewportScanning(options: ViewportScannerOptions): ViewportScanner {
  const { matcher, highlighter, maxHighlights, shouldContinue, onProgress } = options
  const visited = new WeakSet<Text>()

  let nodes = 0
  let hits = 0
  let stopped = false
  let capped = false
  let chain: Promise<void> = Promise.resolve()
  let scanTimer: number | null = null

  const pending = new Set<Element>()

  const scan = (roots: Iterable<Element>) => {
    chain = chain.then(async () => {
      if (stopped || capped) return
      for (const root of roots) {
        if (!root.isConnected) continue
        if (root.id.startsWith("read-frog") || root.closest(".read-frog-react-shadow-host")) {
          continue
        }
        if (stopped || capped) break
        const result = await scanTextNodes(root, {
          matcher,
          highlighter,
          maxHighlights,
          shouldContinue,
          visited,
        })
        nodes += result.nodes
        hits += result.marks
        if (result.capped) capped = true
      }
      highlighter.commit()
      onProgress?.()
    })

    return chain
  }

  const flush = () => {
    if (stopped || capped) return
    if (pending.size === 0) return
    const roots = [...pending]
    pending.clear()
    void scan(roots)
  }

  const queue = (element: Element) => {
    if (stopped || capped) return
    pending.add(element)
    // One batch per burst: a mutation that adds a whole subtree shouldn't walk
    // it per record, and a scroll that crosses ten blocks shouldn't scan ten
    // times.
    if (scanTimer !== null) window.clearTimeout(scanTimer)
    scanTimer = window.setTimeout(() => {
      scanTimer = null
      flush()
    }, 120)
  }

  const blocks = collectCandidates()

  const supportsObserver = typeof IntersectionObserver === "function"
  const observer = supportsObserver
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            observer?.unobserve(entry.target)
            if (!isReadingUnit(entry.target)) continue
            queue(entry.target)
          }
        },
        { rootMargin: SCAN_MARGIN, threshold: 0 },
      )
    : null

  if (observer) {
    for (const block of blocks) observer.observe(block)
  } else {
    // No observer (jsdom, ancient engines): fall back to one pass, chunked.
    for (const block of blocks) {
      if (isReadingUnit(block)) pending.add(block)
    }
    flush()
  }

  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        // Translation inserts wrappers around the text it just translated. Those
        // subtrees carry the same words the scanner already judged, and walking
        // them again on every translated paragraph is what made the two features
        // feed each other.
        if (node.closest(`.${TRANSLATED_CONTENT_CLASSES}`)) continue
        const block =
          node.matches(CONTENT_BLOCK_SELECTOR) || isCustomElement(node)
            ? node
            : node.querySelector(CONTENT_BLOCK_SELECTOR)
        if (block && isReadingUnit(block)) queue(block)
      }
    }
  })
  mutations.observe(document.body, { childList: true, subtree: true })

  return {
    scannedNodes: () => nodes,
    capped: () => capped,
    stop() {
      stopped = true
      observer?.disconnect()
      mutations.disconnect()
      if (scanTimer !== null) window.clearTimeout(scanTimer)
      pending.clear()
    },
  }
}
