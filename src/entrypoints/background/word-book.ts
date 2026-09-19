import type { NotionFieldMapping } from "@/utils/notion/fields"
import type {
  NotionDatabaseListResult,
  NotionDatabaseResult,
  NotionUserResult,
} from "@/utils/notion/result"
import type { WordBookAddResult, WordBookRecord } from "@/utils/word-book/sync"
import { getLocalConfig } from "@/utils/config/storage"
import { db } from "@/utils/db/dexie/db"
import { logger } from "@/utils/logger"
import { onMessage } from "@/utils/message"
import {
  createNotionPage,
  findNotionPageByProperty,
  getNotionDatabase,
  listNotionDatabases,
  validateNotionToken,
} from "@/utils/notion/client"
import { NotionApiError } from "@/utils/notion/errors"
import { buildNotionPageProperties, buildWordLookup } from "@/utils/notion/fields"
import { toNotionResult } from "@/utils/notion/result"
import { createWordBookStore } from "@/utils/word-book/store"
import { WORD_BOOK_SYNC_ERROR } from "@/utils/word-book/sync"
import { ensureInitializedConfig } from "./config"

/**
 * The list is bounded by `MAX_WORD_BOOK_RECORDS`, so replacing it wholesale
 * keeps the store's logic in one place; every mutation here is a user action,
 * not a hot path. Dexie runs the clear+put pair in one transaction, so an
 * interrupted write cannot leave the table half-filled.
 */
const store = createWordBookStore({
  read: () => db.wordBook.orderBy("addedAt").reverse().toArray(),
  write: async (records) => {
    await db.transaction("rw", db.wordBook, async () => {
      await db.wordBook.clear()
      await db.wordBook.bulkPut(records)
    })
  },
})

function readNotionConfig(config: Awaited<ReturnType<typeof getLocalConfig>>) {
  const notion = config?.wordBook?.notion
  if (!notion?.apiKey || !notion.databaseId) {
    return null
  }
  return notion
}

function hasTitleProperty(mappings: NotionFieldMapping[]): boolean {
  return mappings.some((mapping) => mapping.notionPropertyType === "title")
}

/**
 * Writes one entry to Notion and records the outcome on the row. A missing
 * connection or an unusable mapping is not an error the user caused - the entry
 * stays pending so it syncs the moment the settings are filled in.
 */
async function syncWordBookRecord(record: WordBookRecord): Promise<WordBookRecord> {
  const config = await ensureInitializedConfig()
  const notion = readNotionConfig(config)
  if (!notion) {
    return (await store.markPending(record.id, WORD_BOOK_SYNC_ERROR.NOT_CONFIGURED)) ?? record
  }

  const mappings = notion.mappings satisfies NotionFieldMapping[]
  if (!hasTitleProperty(mappings)) {
    return (await store.markPending(record.id, WORD_BOOK_SYNC_ERROR.MAPPING_MISSING)) ?? record
  }

  try {
    // One word, one page: an entry saved from another page or an earlier
    // session is linked instead of duplicated, so the database stays a
    // vocabulary list rather than a reading log.
    const lookup = buildWordLookup(record, mappings)
    if (lookup) {
      const existing = await findNotionPageByProperty(notion.databaseId, lookup, {
        token: notion.apiKey,
      })
      if (existing) {
        return (await store.markSynced(record.id, existing)) ?? record
      }
    }

    const page = await createNotionPage(
      notion.databaseId,
      buildNotionPageProperties(record, mappings),
      {
        token: notion.apiKey,
      },
    )
    return (await store.markSynced(record.id, page)) ?? record
  } catch (error) {
    // The row keeps the raw code: the UI maps it to a localized sentence, and
    // an unmapped code still beats a silent failure.
    const code =
      error instanceof NotionApiError
        ? `${error.status}:${error.code}`
        : error instanceof Error
          ? error.message
          : String(error)
    logger.warn("[WordBook] Notion write failed", code)
    return (await store.markFailed(record.id, code)) ?? record
  }
}

/** Retries everything still owing a write; used on startup and from the panel. */
async function syncPendingWordBookEntries(): Promise<WordBookRecord[]> {
  const pending = await store.listPending()
  const results: WordBookRecord[] = []
  for (const record of pending) {
    results.push(await syncWordBookRecord(record))
  }
  return results
}

export function setupWordBookMessageHandlers(): void {
  onMessage("wordBookAdd", async ({ data }): Promise<WordBookAddResult> => {
    const { record, created } = await store.add(data)
    // Only a fresh entry is pushed: re-saving the same word must not duplicate
    // the Notion page.
    const synced = created ? await syncWordBookRecord(record) : record
    return { record: synced, created }
  })

  onMessage("wordBookList", () => store.list())

  onMessage("wordBookRemove", async ({ data }) => {
    await store.remove(data.id)
  })

  onMessage("wordBookRetry", async ({ data }) => {
    const records = await store.list()
    const record = records.find((entry) => entry.id === data.id)
    return record ? await syncWordBookRecord(record) : null
  })

  onMessage("wordBookSyncPending", () => syncPendingWordBookEntries())

  // The Notion calls below carry a token the caller just typed, so they run
  // before anything is saved: a wrong token must fail loudly in the settings UI.
  onMessage("notionTestConnection", async ({ data }): Promise<NotionUserResult> => {
    try {
      const user = await validateNotionToken({ token: data.apiKey })
      return { ok: true, data: { name: user.name ?? user.id } }
    } catch (error) {
      return toNotionResult(error)
    }
  })

  onMessage("notionListDatabases", async ({ data }): Promise<NotionDatabaseListResult> => {
    try {
      return { ok: true, data: await listNotionDatabases({ token: data.apiKey }) }
    } catch (error) {
      return toNotionResult(error)
    }
  })

  onMessage("notionGetDatabase", async ({ data }): Promise<NotionDatabaseResult> => {
    try {
      return { ok: true, data: await getNotionDatabase(data.databaseId, { token: data.apiKey }) }
    } catch (error) {
      return toNotionResult(error)
    }
  })
}

/** Startup sweep: anything still pending from a previous session goes out now. */
export function setupWordBookPendingSync(): void {
  void syncPendingWordBookEntries().catch((error) => {
    logger.warn("[WordBook] Pending sync sweep failed", error)
  })
}
