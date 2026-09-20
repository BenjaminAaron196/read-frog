// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import { createLazyDispatchQueue, type LazyDispatchOptions } from "../lazy-dispatch"

/**
 * The queue's contract is about *when* units reach the pipeline: never while
 * hidden, only when eligible, a bounded number per slice, and each dispatch
 * separated by a yield. jsdom has no requestIdleCallback, which pins the
 * timer-fallback path. `yieldToMain` is stubbed so the pacing hop does not
 * depend on jsdom's task scheduling — its call count is the yield contract.
 */

const { mockYieldToMain } = vi.hoisted(() => ({
  mockYieldToMain: vi.fn<() => Promise<void>>(async () => {}),
}))

vi.mock("@/utils/scheduler", () => ({ yieldToMain: mockYieldToMain }))

/** Runs the queue's timer-driven slices; the queue is never real-time bound. */
async function runSlices(rounds = 12): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await vi.advanceTimersByTimeAsync(1)
  }
}

function makeUnit(id: string): HTMLElement {
  const el = document.createElement("p")
  el.id = id
  document.body.append(el)
  return el
}

function setupQueue(overrides: Partial<LazyDispatchOptions> = {}) {
  const dispatched: string[] = []
  const queue = createLazyDispatchQueue({
    run: async (unit) => {
      dispatched.push(unit.id)
    },
    isEligible: () => true,
    ...overrides,
  })
  queue.start()
  return { queue, dispatched }
}

describe("lazy dispatch queue", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    document.body.innerHTML = ""
  })

  it("dispatches queued units in order, yielding between insertions", async () => {
    const { queue, dispatched } = setupQueue()
    queue.enqueue([makeUnit("first"), makeUnit("second")])

    await runSlices()

    expect(dispatched).toEqual(["first", "second"])
    expect(mockYieldToMain).toHaveBeenCalledTimes(2)
    expect(queue.pendingCount).toBe(0)
    queue.stop()
  })

  it("queues a unit once, however often it intersects", async () => {
    const { queue, dispatched } = setupQueue()
    const unit = makeUnit("only")

    queue.enqueue([unit])
    queue.enqueue([unit])
    await runSlices()

    expect(dispatched).toEqual(["only"])
    queue.stop()
  })

  it("drops detached units instead of translating them", async () => {
    const { queue, dispatched } = setupQueue()
    const unit = makeUnit("gone")
    queue.enqueue([unit])
    unit.remove()

    await runSlices()

    expect(dispatched).toEqual([])
    expect(queue.pendingCount).toBe(0)
    queue.stop()
  })

  it("holds an out-of-reach unit until it becomes eligible", async () => {
    let eligible = false
    const { queue, dispatched } = setupQueue({ isEligible: () => eligible })
    queue.enqueue([makeUnit("far")])

    await runSlices()
    expect(dispatched).toEqual([])
    expect(queue.pendingCount).toBe(1)

    // The reader scrolls: the viewport change re-arms the blocked queue.
    eligible = true
    window.dispatchEvent(new Event("scroll"))
    await runSlices()

    expect(dispatched).toEqual(["far"])
    queue.stop()
  })

  it("does not translate while the document is hidden, and resumes on return", async () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true)
    const { queue, dispatched } = setupQueue()
    queue.enqueue([makeUnit("hidden")])

    await runSlices()
    expect(dispatched).toEqual([])

    hidden.mockReturnValue(false)
    document.dispatchEvent(new Event("visibilitychange"))
    await runSlices()

    expect(dispatched).toEqual(["hidden"])
    queue.stop()
  })

  it("stops dispatching once the owning session is over", async () => {
    let live = true
    const { queue, dispatched } = setupQueue({ shouldContinue: () => live })
    queue.enqueue([makeUnit("session")])

    live = false
    await runSlices()

    expect(dispatched).toEqual([])
    queue.stop()
  })

  it("bounds how many units one slice hands to the pipeline", async () => {
    const dispatched: string[] = []
    const sliceSizes: number[] = []
    const queue = createLazyDispatchQueue({
      run: async (unit) => {
        dispatched.push(unit.id)
      },
      isEligible: () => true,
      beforeSlice: () => {
        sliceSizes.push(dispatched.length)
      },
      maxUnitsPerSlice: 2,
    })
    queue.start()
    queue.enqueue(["a", "b", "c", "d", "e"].map(makeUnit))

    await runSlices()

    expect(dispatched).toEqual(["a", "b", "c", "d", "e"])
    // One slice start per pair of units: 2 + 2 + 1 across three slices.
    expect(sliceSizes).toEqual([0, 2, 4])
    queue.stop()
  })

  it("drops queued work when stopped", async () => {
    const { queue, dispatched } = setupQueue()
    queue.enqueue([makeUnit("later")])
    queue.stop()

    await runSlices()

    expect(dispatched).toEqual([])
    expect(queue.pendingCount).toBe(0)
  })
})
