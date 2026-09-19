import type { SubtitlesFragment } from "@/utils/subtitles/types"
import { parseTimestampToMs } from "./timestamp"

const PARAGRAPH_PATTERN = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi
const BEGIN_PATTERN = /\bbegin\s*=\s*"([^"]+)"/
const END_PATTERN = /\bend\s*=\s*"([^"]+)"/
const BREAK_PATTERN = /<br\s*\/?>/gi
const TAG_PATTERN = /<[^>]+>/g
const WHITESPACE_PATTERN = /\s+/g
const ENTITY_PATTERN = /&(#x[\da-f]+|#\d+|[a-z]+);/gi

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
}

function decodeEntities(text: string): string {
  return text.replace(ENTITY_PATTERN, (entity, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const codePoint = Number.parseInt(body.slice(2), 16)
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint)
    }
    if (body.startsWith("#")) {
      const codePoint = Number.parseInt(body.slice(1), 10)
      return Number.isNaN(codePoint) ? entity : String.fromCodePoint(codePoint)
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity
  })
}

/**
 * Parses TTML/DFXP caption documents - Bloomberg serves them as `.dfxp` from
 * its media manifest - into cues in milliseconds. Paragraphs carry their own
 * `begin`/`end`; `<br />` separates the two caption lines the broadcaster
 * wrapped, so it collapses into a single line like every other cue source.
 */
export function parseTtmlCues(document: string): SubtitlesFragment[] {
  const cues: SubtitlesFragment[] = []

  for (const match of document.matchAll(PARAGRAPH_PATTERN)) {
    const attributes = match[1] ?? ""
    const start = parseTimestampToMs(attributes.match(BEGIN_PATTERN)?.[1])
    const end = parseTimestampToMs(attributes.match(END_PATTERN)?.[1])
    if (start === null || end === null || end <= start) {
      continue
    }

    const text = decodeEntities((match[2] ?? "").replace(BREAK_PATTERN, " "))
      .replace(TAG_PATTERN, " ")
      .replace(WHITESPACE_PATTERN, " ")
      .trim()
    if (!text) {
      continue
    }

    cues.push({ text, start, end })
  }

  return cues
}
