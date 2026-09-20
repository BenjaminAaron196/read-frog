// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"

const listeners: ((changes: Record<string, unknown>, area: string) => void)[] = []
vi.mock("#imports", () => ({
  browser: {
    storage: {
      onChanged: {
        addListener: (fn: (changes: Record<string, unknown>, area: string) => void) =>
          listeners.push(fn),
        removeListener: () => undefined,
      },
    },
  },
}))

const { watchLearningModeStorage } = await import("../index")

/**
 * A translation writes storage constantly, and every write used to restart the
 * learning mode - which re-reads the dictionary and re-scans the page. The
 * watcher now answers only for the keys the feature depends on.
 */
describe("watchLearningModeStorage", () => {
  it("ignores writes that have nothing to do with the learning mode", () => {
    const onChange = vi.fn<() => void>()
    watchLearningModeStorage(onChange)

    for (const listener of listeners) {
      listener({ "translation-cache:xyz": 1 }, "local")
      listener({ configBackup_123: {} }, "local")
      listener({ config: {} }, "sync")
    }

    expect(onChange).not.toHaveBeenCalled()
  })

  it("restarts for the config and for the dictionary", () => {
    const onChange = vi.fn<() => void>()
    watchLearningModeStorage(onChange)

    for (const listener of listeners) {
      listener({ config: {} }, "local")
      listener({ "learning-mode:dictionary-entries": [] }, "local")
    }

    expect(onChange).toHaveBeenCalledTimes(2 * listeners.length)
  })
})
