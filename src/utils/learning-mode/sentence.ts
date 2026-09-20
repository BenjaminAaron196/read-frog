/**
 * The sentence a marked word sits in — the cheapest useful context the hover
 * card can show without asking a model. Sentence-final punctuation is not
 * language-universal, so the set below covers the Latin marks plus the CJK ones
 * a translated page can hold.
 */
const SENTENCE_BREAKS: Record<string, true> = {
  ".": true,
  "!": true,
  "?": true,
  "。": true,
  "！": true,
  "？": true,
  "…": true,
  "\n": true,
  "\r": true,
  "；": true,
}

/** Longest sentence the card will show before it is truncated. */
const MAX_SENTENCE_LENGTH = 260

/**
 * Extracts the sentence containing `[start, end)` from `text`. Walking outwards
 * from the match keeps this O(sentence) instead of O(paragraph), which matters
 * because it runs for every marked word on the page.
 */
export function extractSentence(text: string, start: number, end: number): string {
  let from = start
  while (from > 0 && SENTENCE_BREAKS[text[from - 1] ?? ""] !== true) {
    from -= 1
  }

  let to = end
  while (to < text.length && SENTENCE_BREAKS[text[to] ?? ""] !== true) {
    to += 1
  }

  const sentence = text.slice(from, Math.min(to + 1, from + MAX_SENTENCE_LENGTH)).trim()
  if (sentence.length <= MAX_SENTENCE_LENGTH) {
    return sentence
  }
  return `${sentence.slice(0, MAX_SENTENCE_LENGTH - 1)}…`
}

/** Below this the "sentence" is a fragment (a link label, a nav item). */
const MIN_USEFUL_CONTEXT_LENGTH = 40
/** The block fallback is a paragraph, not a page. */
const MAX_BLOCK_CONTEXT_LENGTH = 400
const BLOCK_SELECTOR = "p, li, dd, dt, blockquote, figcaption, td, th, section, article"

/**
 * The context line for the card. A marked word often sits in its own element
 * (a link inside a sentence, a table cell), where the text node's own sentence
 * is just the word; falling back to the enclosing block gives the reader the
 * sentence they were actually looking at.
 */
export function extractSentenceFromNode(node: Text, start: number, end: number): string {
  const own = extractSentence(node.data, start, end)
  if (own.length >= MIN_USEFUL_CONTEXT_LENGTH) return own

  const block = node.parentElement?.closest(BLOCK_SELECTOR)
  const blockText = block?.textContent?.trim() ?? ""
  if (blockText.length === 0 || blockText.length > MAX_BLOCK_CONTEXT_LENGTH) return own
  return blockText
}
