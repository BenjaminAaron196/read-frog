import type { NotionDatabase, NotionDatabaseSummary } from "./types"
import { NotionApiError } from "./errors"

/**
 * The shape every Notion call answers with across the message boundary: a
 * refusal is data, not an exception, so a content script or extension page can
 * localize it without matching on error message text.
 */
export type NotionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

export function toNotionResult<T>(error: unknown): NotionResult<T> {
  if (error instanceof NotionApiError) {
    return { ok: false, code: error.code, message: error.message }
  }
  return {
    ok: false,
    code: "unknown_error",
    message: error instanceof Error ? error.message : String(error),
  }
}

export type NotionUserResult = NotionResult<{ name: string | null }>
export type NotionDatabaseListResult = NotionResult<NotionDatabaseSummary[]>
export type NotionDatabaseResult = NotionResult<NotionDatabase>
