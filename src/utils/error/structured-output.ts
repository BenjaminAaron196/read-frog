/**
 * Some OpenAI-compatible relays reject `response_format` outright — the note
 * suggestion arrives as a browser 400 whose body says the type is unavailable.
 * Callers use this to ask again without structured output, which the AI SDK
 * then parses from plain text instead.
 */
export function isStructuredOutputUnsupportedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false
  }

  const candidate = error as { statusCode?: unknown; responseBody?: unknown; message?: unknown }
  const detail = `${typeof candidate.responseBody === "string" ? candidate.responseBody : ""} ${
    typeof candidate.message === "string" ? candidate.message : ""
  }`
  if (!/response_format|json_schema|structured output/i.test(detail)) {
    return false
  }

  // The AI SDK's own retry wrapper collapses a 400 into a plain Error that
  // keeps neither status nor body, so the wording of the body has to be enough
  // on its own.
  if (candidate.statusCode === undefined) {
    return /invalid_request_error|unavailable|not supported|400/i.test(detail)
  }

  return candidate.statusCode === 400 || candidate.statusCode === 422
}
