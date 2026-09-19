import type {
  NotionApiErrorBody,
  NotionDatabase,
  NotionDatabaseSummary,
  NotionPage,
  NotionSearchResponse,
  NotionUser,
} from "./types"
import { NotionApiError } from "./errors"
import { NOTION_API_BASE_URL, NOTION_API_VERSION } from "./types"

/** The only call shape this client makes, so tests can stub it with two args. */
export type NotionFetchImpl = (url: string, init: RequestInit) => Promise<Response>

interface NotionRequestOptions {
  token: string
  fetchImpl?: NotionFetchImpl
}

interface NotionRequestInput extends NotionRequestOptions {
  method?: "GET" | "POST"
  body?: unknown
}

const SEARCH_PAGE_SIZE = 100
const MAX_SEARCH_PAGES = 5

async function requestNotion<T>(path: string, input: NotionRequestInput): Promise<T> {
  const { token, fetchImpl = fetch, method = "GET", body } = input

  let response: Response
  try {
    response = await fetchImpl(`${NOTION_API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_API_VERSION,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    // The request never reached Notion (offline, DNS, blocked): not an API
    // refusal, but the caller still needs one error shape to report.
    throw new NotionApiError(
      0,
      "network_error",
      error instanceof Error ? error.message : String(error),
    )
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const errorBody = payload as NotionApiErrorBody | null
    throw new NotionApiError(
      response.status,
      errorBody?.code ?? "unknown_error",
      errorBody?.message ?? response.statusText,
    )
  }

  return payload as T
}

/** Cheap identity probe: a wrong or revoked token fails here with 401. */
export function validateNotionToken(options: NotionRequestOptions): Promise<NotionUser> {
  return requestNotion<NotionUser>("/users/me", options)
}

function databaseTitle(title: string | Array<{ plain_text?: string }> | undefined): string {
  if (typeof title === "string") {
    return title
  }
  return (title ?? [])
    .map((part) => part.plain_text ?? "")
    .join("")
    .trim()
}

/** Every database the integration was explicitly shared with. */
export async function listNotionDatabases(
  options: NotionRequestOptions,
): Promise<NotionDatabaseSummary[]> {
  const databases: NotionDatabaseSummary[] = []
  let cursor: string | null = null

  for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
    const searchBody: Record<string, unknown> = {
      filter: { value: "database", property: "object" },
      page_size: SEARCH_PAGE_SIZE,
    }
    if (cursor) {
      searchBody.start_cursor = cursor
    }

    const result = await requestNotion<NotionSearchResponse>("/search", {
      ...options,
      method: "POST",
      body: searchBody,
    })

    for (const entry of result.results) {
      if (entry.object === "database") {
        databases.push({ id: entry.id, title: databaseTitle(entry.title) })
      }
    }

    if (!result.has_more || !result.next_cursor) {
      break
    }
    cursor = result.next_cursor
  }

  return databases
}

/** The database's own schema drives the field mapping in the options page. */
export async function getNotionDatabase(
  databaseId: string,
  options: NotionRequestOptions,
): Promise<NotionDatabase> {
  const payload = await requestNotion<{
    id: string
    title?: Array<{ plain_text?: string }>
    properties?: Record<string, { id: string; name: string; type: string }>
  }>(`/databases/${databaseId}`, options)

  return {
    id: payload.id,
    title: databaseTitle(payload.title),
    properties: payload.properties ?? {},
  }
}

export async function createNotionPage(
  databaseId: string,
  properties: Record<string, unknown>,
  options: NotionRequestOptions,
): Promise<NotionPage> {
  return requestNotion<NotionPage>("/pages", {
    ...options,
    method: "POST",
    body: { parent: { database_id: databaseId }, properties },
  })
}

/**
 * The first page whose mapped property already holds this value, or null.
 * Consulted before creating an entry so one word never lands in the database
 * twice, no matter how many pages it was read on.
 */
export async function findNotionPageByProperty(
  databaseId: string,
  lookup: { propertyName: string; propertyType: "title" | "rich_text"; value: string },
  options: NotionRequestOptions,
): Promise<NotionPage | null> {
  const payload = await requestNotion<{ results?: Array<{ id: string; url: string }> }>(
    `/databases/${databaseId}/query`,
    {
      ...options,
      method: "POST",
      body: {
        page_size: 1,
        filter: {
          property: lookup.propertyName,
          [lookup.propertyType]: { equals: lookup.value },
        },
      },
    },
  )

  const page = payload.results?.[0]
  return page ? { id: page.id, url: page.url } : null
}
