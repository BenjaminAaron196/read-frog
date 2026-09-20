import type { WordMatcher } from "./lookup"
import type { LearningMatch } from "./types"

/**
 * A subtitle line, split into what can be marked and what cannot.
 *
 * The page marks text with the Custom Highlight API, which cannot paint inside a
 * shadow root - and the subtitles live in one. Here the line is rendered by us,
 * so the marks are elements: a token per word, carrying whatever the profile
 * said about it.
 */
export interface SubtitleWordToken {
  kind: "word"
  /** The word as it appears in the line, which is what the reader sees. */
  text: string
  /** The profile's verdict, or null for a word it does not mark. */
  match: LearningMatch | null
}

export interface SubtitleTextToken {
  kind: "text"
  /** Punctuation and spacing, kept verbatim so the line reads the same. */
  text: string
}

export type SubtitleToken = SubtitleWordToken | SubtitleTextToken

/**
 * Word characters: letters in any script, plus the apostrophes and hyphens that
 * appear inside English words ("don't", "far-right"). Digits join them so
 * "2029" stays one token instead of being spliced into its neighbours.
 */
const WORD_CHAR = /[\p{L}\p{N}\u2019'-]/u

/** Characters that cannot start or end a word, only surround it. */
const LEADING_PUNCTUATION = /^[^\p{L}\p{N}]+/u
const TRAILING_PUNCTUATION = /[^\p{L}\p{N}]+$/u

/**
 * Splits a line into words and the text between them.
 *
 * A word is the longest run of word characters, minus anything at its edges that
 * only ever surrounds a word: `Houthis'` marks the name, not the apostrophe, and
 * the apostrophe still renders where it was.
 */
export function tokenizeSubtitle(text: string): SubtitleToken[] {
  const tokens: SubtitleToken[] = []
  let buffer = ""
  let bufferIsWord = false

  const flush = () => {
    if (buffer === "") return
    if (!bufferIsWord) {
      tokens.push({ kind: "text", text: buffer })
      buffer = ""
      return
    }

    const leading = LEADING_PUNCTUATION.exec(buffer)?.[0] ?? ""
    const rest = buffer.slice(leading.length)
    const trailing = TRAILING_PUNCTUATION.exec(rest)?.[0] ?? ""
    const core = rest.slice(0, rest.length - trailing.length)

    if (leading) tokens.push({ kind: "text", text: leading })
    if (core) tokens.push({ kind: "word", text: core, match: null })
    if (trailing) tokens.push({ kind: "text", text: trailing })
    buffer = ""
  }

  for (const character of text) {
    const isWord = WORD_CHAR.test(character)
    if (buffer !== "" && isWord !== bufferIsWord) flush()
    buffer += character
    bufferIsWord = isWord
  }
  flush()

  return tokens
}

/**
 * The line with the profile applied: every word carries its verdict, so the
 * renderer only has to look at the token.
 */
export function markSubtitleText(text: string, matcher: WordMatcher): SubtitleToken[] {
  return tokenizeSubtitle(text).map((token) =>
    token.kind === "word" ? { ...token, match: matcher(token.text) } : token,
  )
}
