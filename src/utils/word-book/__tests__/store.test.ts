import type { WordBookRecord } from "../types"
import { beforeEach, describe, expect, it } from "vitest"
import { createWordBookStore, type WordBookStorage } from "../store"

interface MemoryStorage extends WordBookStorage {
  readonly records: WordBookRecord[]
}

function createMemoryStorage(initial: WordBookRecord[] = []): MemoryStorage {
  const state = { records: [...initial] }
  return {
    get records() {
      return state.records
    },
    read: async () => [...state.records],
    write: async (records) => {
      state.records = [...records]
    },
  }
}

function draft(word: string, sourceUrl = "https://example.com/story") {
  return {
    word,
    definition: `meaning of ${word}`,
    context: `a sentence with ${word}`,
    sourceUrl,
    sourceTitle: "Example story",
  }
}

describe("word book store", () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = createMemoryStorage()
  })

  it("stores a new entry as pending with the draft fields", async () => {
    const store = createWordBookStore(storage)

    const { record, created } = await store.add(draft("frog"))

    expect(created).toBe(true)
    expect(record).toMatchObject({
      word: "frog",
      definition: "meaning of frog",
      context: "a sentence with frog",
      sourceUrl: "https://example.com/story",
      syncStatus: "pending",
      syncAttempts: 0,
    })
    expect(storage.records).toHaveLength(1)
  })

  it("returns the first entry instead of saving the same word from the same page twice", async () => {
    const store = createWordBookStore(storage)
    const first = await store.add(draft("Frog"))

    const second = await store.add(draft("  frog  "))

    expect(second.created).toBe(false)
    expect(second.record.id).toBe(first.record.id)
    expect(storage.records).toHaveLength(1)
  })

  it("keeps a second sighting from another page as its own entry", async () => {
    const store = createWordBookStore(storage)
    await store.add(draft("frog", "https://example.com/one"))

    const other = await store.add(draft("frog", "https://example.com/two"))

    expect(other.created).toBe(true)
    expect(storage.records).toHaveLength(2)
  })

  it("marks an entry as synced once Notion answered", async () => {
    const store = createWordBookStore(storage)
    const { record } = await store.add(draft("frog"))

    const updated = await store.markSynced(record.id, { id: "page-1", url: "https://notion.so/x" })

    expect(updated).toMatchObject({
      syncStatus: "created",
      notionPageId: "page-1",
      notionUrl: "https://notion.so/x",
    })
    await expect(store.listPending()).resolves.toEqual([])
  })

  it("records a failed attempt with the reason and the attempt count", async () => {
    const store = createWordBookStore(storage)
    const { record } = await store.add(draft("frog"))

    await store.markFailed(record.id, "database not found")
    const second = await store.markFailed(record.id, "database not found")

    expect(second).toMatchObject({
      syncStatus: "failed",
      syncError: "database not found",
      syncAttempts: 2,
    })
  })

  it("keeps an entry queued - not failed - while the connection is missing", async () => {
    const store = createWordBookStore(storage)
    const { record } = await store.add(draft("frog"))

    const waiting = await store.markPending(record.id, "notion_not_configured")

    expect(waiting).toMatchObject({
      syncStatus: "pending",
      syncError: "notion_not_configured",
      syncAttempts: 0,
    })
    // Still owed a write, so the sweep picks it up again.
    await expect(store.listPending()).resolves.toHaveLength(1)
  })

  it("lists pending entries oldest first and drops removed ones", async () => {
    const store = createWordBookStore(storage)
    const older = await store.add(draft("alpha"))
    const newer = await store.add(draft("beta"))
    await store.markSynced(newer.record.id, { id: "page-2", url: "https://notion.so/y" })

    const pending = await store.listPending()
    expect(pending.map((entry) => entry.word)).toEqual(["alpha"])

    await store.remove(older.record.id)
    await expect(store.list()).resolves.toHaveLength(1)
  })
})
