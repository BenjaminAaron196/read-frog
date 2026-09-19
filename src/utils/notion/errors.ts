/** A refusal from Notion, carrying its own error code so callers can localize. */
export class NotionApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = "NotionApiError"
    this.status = status
    this.code = code
  }
}

/** 401 means the pasted token is wrong or was revoked. */
export function isNotionAuthError(error: unknown): boolean {
  return error instanceof NotionApiError && error.status === 401
}

/** 404 on a database id usually means the integration was never shared with it. */
export function isNotionNotFoundError(error: unknown): boolean {
  return error instanceof NotionApiError && error.status === 404
}
