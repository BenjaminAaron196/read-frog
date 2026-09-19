import { isAbortLikeError } from "./abort"

/** Matches the AI SDK's default: one attempt plus two retries. */
export const API_RETRY_ATTEMPTS = 3
const BASE_DELAY_MS = 600

/**
 * Whether another attempt could plausibly succeed. The AI SDK marks its own
 * errors, but a plain fetch failure carries only a name, and a relay that
 * answered 5xx or 429 is worth one more try.
 */
export function isRetryableApiError(error: unknown): boolean {
  if (isAbortLikeError(error)) {
    return false
  }

  const candidate = error as { isRetryable?: unknown; statusCode?: unknown; name?: unknown }
  if (candidate?.isRetryable === true) {
    return true
  }
  if (typeof candidate?.statusCode === "number") {
    return candidate.statusCode === 429 || candidate.statusCode >= 500
  }
  if (candidate?.name === "AI_APICallError") {
    return true
  }

  // A fetch that never reached the server (offline, DNS) throws a TypeError.
  return candidate?.name === "TypeError"
}

export interface ApiRetryOptions {
  signal?: AbortSignal
  attempts?: number
  /**
   * Veto a retry when the consumer can no longer accept one - a translation
   * that already emitted text would be duplicated by a second run.
   */
  canRetry?: () => boolean
  delayMs?: (attempt: number) => number
}

/**
 * Retry a request-producing call, rethrowing the LAST error itself rather than
 * a wrapper. That is the whole point: callers report the provider's status,
 * URL, and response body, and the AI SDK's own retry collapses them into a
 * "Failed after 3 attempts. Last error: AI_APICallError" string.
 */
export async function runWithApiRetry<T>(
  run: () => Promise<T>,
  options: ApiRetryOptions = {},
): Promise<T> {
  const { signal, attempts = API_RETRY_ATTEMPTS, canRetry, delayMs } = options

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run()
    } catch (error) {
      const isLastAttempt = attempt >= attempts
      if (
        isLastAttempt ||
        signal?.aborted ||
        isAbortLikeError(error) ||
        (canRetry && !canRetry()) ||
        !isRetryableApiError(error)
      ) {
        throw error
      }

      const wait = delayMs?.(attempt) ?? BASE_DELAY_MS * attempt
      await new Promise((resolve) => setTimeout(resolve, wait))
      if (signal?.aborted) {
        throw error
      }
    }
  }
}
