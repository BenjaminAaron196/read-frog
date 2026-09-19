import type { SubtitlesFragment } from "@/utils/subtitles/types"
import { parseTimestampToMs } from "./timestamp"

const CUE_TIMING_PATTERN = /-->/
const TAG_PATTERN = /<[^>]+>/g
const WHITESPACE_PATTERN = /\s+/g
const CUE_SETTING_SEPARATOR_PATTERN = /\s+/

/**
 * Parses WebVTT caption documents - Reuters serves one segment per video from
 * its ajo CDN - into cues in milliseconds. Settings after the end timestamp
 * (`line:-3` on Reuters) and inline markup are dropped; multi-line payloads
 * collapse into a single line, matching how the overlay renders cues.
 */
export function parseVttCues(vtt: string): SubtitlesFragment[] {
  const cues: SubtitlesFragment[] = []

  for (const block of vtt.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    if (!block || block.startsWith("NOTE")) {
      continue
    }

    const lines = block.split("\n")
    const timingIndex = lines.findIndex((line) => line.includes("-->"))
    if (timingIndex === -1) {
      continue
    }

    const [rawStart, rawEnd] = (lines[timingIndex] ?? "").split(CUE_TIMING_PATTERN)
    const start = parseTimestampToMs(rawStart)
    const end = parseTimestampToMs(rawEnd?.trim().split(CUE_SETTING_SEPARATOR_PATTERN)[0])
    if (start === null || end === null || end <= start) {
      continue
    }

    const text = lines
      .slice(timingIndex + 1)
      .join(" ")
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
