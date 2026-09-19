/**
 * The slice of the Notion API this extension uses. Requests pin
 * `Notion-Version: 2022-06-28`, where a page hangs off a database directly;
 * newer versions require resolving a data source id first.
 */
export const NOTION_API_BASE_URL = "https://api.notion.com/v1"
export const NOTION_API_VERSION = "2022-06-28"

export interface NotionUser {
  id: string
  name: string | null
  type: "bot" | "person"
  bot?: { owner?: { type?: string } }
}

export interface NotionDatabaseProperty {
  id: string
  name: string
  type: string
}

export interface NotionDatabase {
  id: string
  title: string
  properties: Record<string, NotionDatabaseProperty>
}

export interface NotionDatabaseSummary {
  id: string
  title: string
}

export interface NotionSearchResponse {
  results: Array<{
    object: string
    id: string
    title?: Array<{ plain_text?: string }>
  }>
  has_more: boolean
  next_cursor: string | null
}

export interface NotionPage {
  id: string
  url: string
}

export interface NotionApiErrorBody {
  object: "error"
  status: number
  code: string
  message: string
}
