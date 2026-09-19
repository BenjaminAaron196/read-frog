/**
 * Extract error message from API response
 * Handles various error formats: JSON string, { error: { message } }, { message }, plain text
 */
export async function extractErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`
  const text = await response.text()

  if (!text) return fallback

  try {
    const json = JSON.parse(text)
    if (typeof json === "string") return json
    if (json.error?.message) return json.error.message
    if (json.message) return json.message
    return fallback
  } catch {
    return text.slice(0, 100)
  }
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** Provider bodies can be long; the popover shows the message on two lines. */
const MAX_SURFACED_ERROR_CHARS = 400

/**
 * An HTML body means no model answered: a proxy, DNS filter, or block page got
 * in the way. Dumping the markup tells the user nothing and floods the popover,
 * so keep the one useful line and say what it is.
 */
function summarizeResponseBody(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith("<")) {
    return trimmed
  }

  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(trimmed)?.[1]?.trim()
  return title
    ? `HTML page instead of a model reply (${title}) - check the endpoint and any network filter`
    : "HTML page instead of a model reply - check the endpoint and any network filter"
}

function truncateForDisplay(message: string): string {
  return message.length > MAX_SURFACED_ERROR_CHARS
    ? `${message.slice(0, MAX_SURFACED_ERROR_CHARS)}…`
    : message
}

export function extractAISDKErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return truncateForDisplay(summarizeResponseBody(error))
  }

  if (typeof error === "object" && error !== null) {
    const source = error as {
      message?: unknown
      responseBody?: unknown
      text?: unknown
    }

    const message = getNonEmptyString(source.message)
    const responseBody = getNonEmptyString(source.responseBody)
    const text = getNonEmptyString(source.text)

    if (isGenericAISDKErrorMessage(message) || (message && isBareHttpStatusMessage(message))) {
      return truncateForDisplay(
        summarizeResponseBody(responseBody ?? text ?? message ?? "Unexpected error occurred"),
      )
    }

    const detail = message ?? responseBody ?? text ?? "Unexpected error occurred"
    return truncateForDisplay(detail.includes("<") ? summarizeResponseBody(detail) : detail)
  }

  return "Unexpected error occurred"
}

/**
 * A bare status phrase ("Bad Request", "404") says nothing the response body
 * would not say better, so the body wins for those.
 */
function isBareHttpStatusMessage(message: string): boolean {
  return /^(?:\d{3}|bad request|unauthorized|forbidden|not found|method not allowed|request timeout|too many requests|internal server error|bad gateway|service unavailable|gateway timeout)$/i.test(
    message.trim(),
  )
}

function isGenericAISDKErrorMessage(message: string | undefined): boolean {
  if (!message) {
    return true
  }

  const normalizedMessage = message.trim().toLowerCase()
  return (
    normalizedMessage === "something went wrong" ||
    normalizedMessage === "unexpected error occurred"
  )
}
