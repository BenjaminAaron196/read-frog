import { logger } from "@/utils/logger"
import { sendMessage } from "@/utils/message"
import { getStyleClassifyPrompt, parseStyleVerdict } from "@/utils/prompts/translate-style"

/**
 * What genre a page is, as decided once per URL.
 *
 * The finished prompt is the translation cache key, and the side that hashes a
 * paragraph (the content script) is not the side that translates it (the
 * background). A model asked twice may answer differently, which would mean two
 * prompts for one page: cache misses, and hashes that never match. So the answer
 * is computed once per URL in the background and handed to every other context,
 * which caches it here and reads it synchronously while building prompts.
 *
 * `undefined` means "not asked yet" and is deliberately different from `null`
 * ("asked, nothing named a genre"): the first leaves the request on the default
 * prompt for now, the second settles it there.
 */
const verdicts = new Map<string, string | null>()
const inFlight = new Map<string, Promise<string | null>>()

export function rememberStyleVerdict(url: string, styleId: string | null): void {
  verdicts.set(url, styleId)
}

/** The verdict for a URL: a style id, null for "no style", undefined for "unknown". */
export function styleVerdictFor(url: string): string | null | undefined {
  return verdicts.get(url)
}

/** Whether the verdict is already known; the popup asks before showing a label. */
export function hasStyleVerdict(url: string): boolean {
  return verdicts.has(url)
}

/** Runs the classifier through the background, once per URL per context. */
export async function ensureStyleVerdict(input: {
  url: string
  title?: string | null
  description?: string | null
}): Promise<string | null> {
  if (verdicts.has(input.url)) return verdicts.get(input.url) ?? null

  const pending = inFlight.get(input.url)
  if (pending) return pending

  const request = (async () => {
    try {
      const answer = await sendMessage("translateStyleVerdict", {
        url: input.url,
        title: input.title ?? null,
        description: input.description ?? null,
      })
      const styleId = answer?.styleId ?? null
      // `unavailable` is not an answer about the page: remembering it would pin
      // this context to the default prompt while the other side classifies it
      // properly later, and the two would build different prompts.
      if (answer?.status !== "unavailable") verdicts.set(input.url, styleId)
      return styleId
    } catch (error) {
      logger.warn("[TranslateStyle] Classification unavailable", error)
      return null
    } finally {
      inFlight.delete(input.url)
    }
  })()

  inFlight.set(input.url, request)
  return request
}

/** Exported for the background, which answers the message with this. */
export function classifyStyleAnswer(answer: string): string | null {
  return parseStyleVerdict(answer)
}

export { getStyleClassifyPrompt }
