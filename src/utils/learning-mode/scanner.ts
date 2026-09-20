import type { LearningHighlighter } from "./highlighter"
import type { WordMatcher } from "./lookup"
import {
  CONTENT_WRAPPER_CLASS,
  INLINE_ATOM_CLASS,
  NOTRANSLATE_CLASS,
  REACT_SHADOW_HOST_CLASS,
} from "@/utils/constants/dom-labels"
import { yieldToMain } from "@/utils/scheduler"
import { extractSentenceFromNode } from "./sentence"

/**
 * Subtrees the scan never enters: markup, form controls, code, and everything
 * the extension itself renders (its shadow hosts, its translation wrappers).
 * `notranslate` is honoured because the page or the reader already declared that
 * region off-limits to text processing.
 */
const SKIP_SELECTOR = [
  "script",
  "style",
  "noscript",
  "template",
  "textarea",
  "input",
  "select",
  "option",
  "code",
  "pre",
  "kbd",
  "samp",
  "svg",
  "math",
  '[contenteditable="true"]',
  `.${NOTRANSLATE_CLASS}`,
  `.${REACT_SHADOW_HOST_CLASS}`,
  `.${CONTENT_WRAPPER_CLASS}`,
  `.${INLINE_ATOM_CLASS}`,
  '[id^="read-frog"]',
].join(",")

/** English word boundaries; the leading letter keeps digits and operators out. */
const WORD_PATTERN = /[A-Za-z][A-Za-z'’-]*/g

/** Nodes per idle slice: large enough to finish a page quickly, small enough to stay responsive. */
const NODES_PER_SLICE = 400

export interface ScanOptions {
  matcher: WordMatcher
  highlighter: LearningHighlighter
  maxHighlights: number
  shouldContinue?: () => boolean
  /**
   * Text nodes already looked at in this run. The viewport scanner walks the
   * page in pieces as the reader scrolls, so without this every later piece
   * would re-judge the same text — and re-add the same ranges.
   */
  visited?: WeakSet<Text>
}

export interface ScanResult {
  nodes: number
  marks: number
  /** True when the cap stopped the run before the document was exhausted. */
  capped: boolean
}

/**
 * Walks the text nodes under `root` and hands every dictionary word above the
 * reader's level to the highlighter. The walk yields between slices so a long
 * article does not block input, and stops once `maxHighlights` marks exist —
 * past that point the extras cost more (paint, hit-testing) than they inform.
 */
export async function scanTextNodes(root: ParentNode, options: ScanOptions): Promise<ScanResult> {
  const { matcher, highlighter, maxHighlights, shouldContinue, visited } = options
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

  let nodes = 0
  let marks = 0
  let capped = false
  let sinceYield = 0

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (shouldContinue && !shouldContinue()) break

    const text = node as Text
    const parent = text.parentElement
    if (!parent || parent.closest(SKIP_SELECTOR)) continue
    if (visited) {
      if (visited.has(text)) continue
      visited.add(text)
    }

    const content = text.data
    if (content.length < 3 || !/[A-Za-z]/.test(content)) continue

    nodes += 1
    sinceYield += 1

    WORD_PATTERN.lastIndex = 0
    for (
      let match = WORD_PATTERN.exec(content);
      match !== null;
      match = WORD_PATTERN.exec(content)
    ) {
      const surface = match[0]
      if (surface.length < 3 || surface === surface.toUpperCase()) continue
      // A capital after the first letter is a brand or an identifier ("JavaScript",
      // "iPhone"), not a word a vocabulary list can teach.
      if (/[A-Z]/.test(surface.slice(1))) continue

      const verdict = matcher(surface)
      if (!verdict) continue

      const start = match.index
      const range = document.createRange()
      range.setStart(text, start)
      range.setEnd(text, start + surface.length)
      highlighter.add(range, verdict, extractSentenceFromNode(text, start, start + surface.length))
      marks += 1

      if (marks >= maxHighlights) {
        capped = true
        break
      }
    }

    if (capped) break

    if (sinceYield >= NODES_PER_SLICE) {
      sinceYield = 0
      await yieldToMain()
    }
  }

  return { nodes, marks, capped }
}
