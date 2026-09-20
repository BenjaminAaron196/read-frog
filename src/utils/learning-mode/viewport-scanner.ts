import type { LearningHighlighter } from "./highlighter"
import type { WordMatcher } from "./lookup"
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
 * The elements worth scanning: leaf-level reading units only. Container
 * elements (article, section, div) are deliberately absent — scanning one of
 * those walks its whole subtree, which is the full-page pass this module exists
 * to avoid.
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
].join(",")

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

  const blocks = [...document.querySelectorAll(CONTENT_BLOCK_SELECTOR)]

  const supportsObserver = typeof IntersectionObserver === "function"
  const observer = supportsObserver
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            observer?.unobserve(entry.target)
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
    for (const block of blocks) pending.add(block)
    flush()
  }

  const mutations = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLElement)) continue
        const block = node.matches(CONTENT_BLOCK_SELECTOR)
          ? node
          : node.querySelector(CONTENT_BLOCK_SELECTOR)
        if (block) queue(block)
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
