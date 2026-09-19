const TIMESTAMP_PATTERN = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/

/** Parses `HH:MM:SS.mmm` / `MM:SS,mmm` caption timestamps into milliseconds. */
export function parseTimestampToMs(value: string | undefined): number | null {
  const match = value?.trim().match(TIMESTAMP_PATTERN)
  const minutes = match?.[2]
  const seconds = match?.[3]
  if (!match || minutes === undefined || seconds === undefined) {
    return null
  }

  const hours = Number(match[1] ?? 0)
  const fraction = match[4]
  const milliseconds = fraction ? Number(fraction.padEnd(3, "0")) : 0

  return ((hours * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + milliseconds
}
