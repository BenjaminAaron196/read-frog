import type { NotionFetchImpl } from "../client"
import { describe, expect, it, vi } from "vitest"
import {
  createNotionPage,
  findNotionPageByProperty,
  getNotionDatabase,
  listNotionDatabases,
  validateNotionToken,
} from "../client"
import { NotionApiError, isNotionAuthError } from "../errors"
import { NOTION_API_VERSION } from "../types"

function parseBody(init: RequestInit | undefined): unknown {
  const { body } = init ?? {}
  return typeof body === "string" ? JSON.parse(body) : null
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as Response
}

describe("notion client", () => {
  it("authenticates with the token and the pinned API version", async () => {
    const fetchImpl = vi.fn<NotionFetchImpl>(async () =>
      jsonResponse({ id: "bot-1", name: "Reader", type: "bot" }),
    )

    const user = await validateNotionToken({ token: "secret_token", fetchImpl })

    expect(user.id).toBe("bot-1")
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("https://api.notion.com/v1/users/me")
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer secret_token",
      "Notion-Version": NOTION_API_VERSION,
    })
  })

  it("surfaces a revoked token as an auth error", async () => {
    const fetchImpl = vi.fn<NotionFetchImpl>(async () =>
      jsonResponse(
        { object: "error", status: 401, code: "unauthorized", message: "API token is invalid." },
        401,
      ),
    )

    const error = await validateNotionToken({ token: "bad", fetchImpl }).catch(
      (thrown: unknown) => thrown,
    )

    expect(error).toBeInstanceOf(NotionApiError)
    expect(isNotionAuthError(error)).toBe(true)
    expect((error as NotionApiError).message).toBe("API token is invalid.")
  })

  it("reports a request that never reached Notion", async () => {
    const fetchImpl = vi.fn<NotionFetchImpl>(async () => {
      throw new TypeError("Failed to fetch")
    })

    const error = await validateNotionToken({ token: "any", fetchImpl }).catch((thrown) => thrown)

    expect(error).toBeInstanceOf(NotionApiError)
    expect((error as NotionApiError).status).toBe(0)
    expect((error as NotionApiError).code).toBe("network_error")
  })

  it("pages through the databases the integration can see, skipping other objects", async () => {
    const fetchImpl = vi
      .fn<NotionFetchImpl>()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            { object: "database", id: "db-1", title: [{ plain_text: "Words" }] },
            { object: "page", id: "page-1" },
          ],
          has_more: true,
          next_cursor: "cursor-1",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [{ object: "database", id: "db-2", title: [{ plain_text: "Phrases" }] }],
          has_more: false,
          next_cursor: null,
        }),
      )

    const databases = await listNotionDatabases({ token: "secret_token", fetchImpl })

    expect(databases).toEqual([
      { id: "db-1", title: "Words" },
      { id: "db-2", title: "Phrases" },
    ])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(parseBody(fetchImpl.mock.calls[1]?.[1])).toMatchObject({
      start_cursor: "cursor-1",
    })
  })

  it("reads a database schema with its property names and types", async () => {
    const fetchImpl = vi.fn<NotionFetchImpl>(async () =>
      jsonResponse({
        id: "db-1",
        title: [{ plain_text: "Words" }],
        properties: {
          Word: { id: "title", name: "Word", type: "title" },
          Meaning: { id: "abc", name: "Meaning", type: "rich_text" },
        },
      }),
    )

    const database = await getNotionDatabase("db-1", { token: "secret_token", fetchImpl })

    expect(database.title).toBe("Words")
    expect(Object.values(database.properties).map((property) => property.name)).toEqual([
      "Word",
      "Meaning",
    ])
  })

  it("looks up an existing entry by the mapped word property before creating one", async () => {
    const fetchImpl = vi.fn<NotionFetchImpl>(async () =>
      jsonResponse({ results: [{ id: "page-9", url: "https://notion.so/page-9" }] }),
    )

    const page = await findNotionPageByProperty(
      "db-1",
      { propertyName: "Word", propertyType: "title", value: "ephemeral" },
      { token: "secret_token", fetchImpl },
    )

    expect(page).toEqual({ id: "page-9", url: "https://notion.so/page-9" })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe("https://api.notion.com/v1/databases/db-1/query")
    expect(parseBody(init)).toEqual({
      page_size: 1,
      filter: { property: "Word", title: { equals: "ephemeral" } },
    })
  })

  it("reports no match when the database has no such entry", async () => {
    const fetchImpl = vi.fn<NotionFetchImpl>(async () => jsonResponse({ results: [] }))

    const page = await findNotionPageByProperty(
      "db-1",
      { propertyName: "Meaning", propertyType: "rich_text", value: "frog" },
      { token: "secret_token", fetchImpl },
    )

    expect(page).toBeNull()
    expect(parseBody(fetchImpl.mock.calls[0]?.[1])).toEqual({
      page_size: 1,
      filter: { property: "Meaning", rich_text: { equals: "frog" } },
    })
  })

  it("creates a page inside the chosen database", async () => {
    const fetchImpl = vi.fn<NotionFetchImpl>(async () =>
      jsonResponse({ id: "page-1", url: "https://notion.so/page-1" }),
    )

    const page = await createNotionPage(
      "db-1",
      { Word: { title: [{ text: { content: "frog" } }] } },
      { token: "secret_token", fetchImpl },
    )

    expect(page.url).toBe("https://notion.so/page-1")
    expect(parseBody(fetchImpl.mock.calls[0]?.[1])).toEqual({
      parent: { database_id: "db-1" },
      properties: { Word: { title: [{ text: { content: "frog" } }] } },
    })
  })
})
