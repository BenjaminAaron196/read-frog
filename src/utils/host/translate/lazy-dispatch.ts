import { logger } from "@/utils/logger"
import { yieldToMain } from "@/utils/scheduler"

/**
 * Units one idle slice may hand to the translation pipeline. Each unit becomes
 * its own request, so this is also the bound on how much text one slice pushes
 * into the queue at once.
 */
export const LAZY_DISPATCH_MAX_UNITS_PER_SLICE = 4

/** An idle slice stops handing out work below this much remaining time. */
const MIN_SLICE_TIME_MS = 2

/**
 * Deferral cap for an idle slice. A translation-heavy page never reaches a
 * genuinely idle main thread, so `requestIdleCallback` without a timeout would
 * starve the queue; the timeout keeps slices flowing on a busy page.
 */
const IDLE_SLICE_TIMEOUT_MS = 1000

interface IdleDeadlineLike {
  didTimeout: boolean
  timeRemaining: () => number
}

interface IdleCallbackHost {
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout?: number },
  ) => number
  cancelIdleCallback?: (handle: number) => void
}

export interface LazyDispatchOptions {
  /** Hands one queued unit to the translation pipeline; awaited before the next starts. */
  run: (unit: HTMLElement) => Promise<void>
  /**
   * Whether a unit may start now. Until this holds the unit stays queued —
   * that is what keeps translation from running ahead of the reader.
   */
  isEligible: (unit: HTMLElement) => boolean
  /** Session liveness gate, consulted before, between and after dispatches. */
  shouldContinue?: () => boolean
  /** Runs once per idle slice before its first dispatch (e.g. a config refresh). */
  beforeSlice?: () => Promise<void> | void
  maxUnitsPerSlice?: number
}

export interface LazyDispatchQueue {
  /** Queues units, dropping duplicates and detached nodes. */
  enqueue: (units: Iterable<HTMLElement>) => void
  /** Starts draining and follows document visibility plus viewport changes. */
  start: () => void
  /** Drops everything queued and stops following the document. */
  stop: () => void
  /** Units still waiting for their turn (tests and diagnostics). */
  readonly pendingCount: number
}

/**
 * Idle-time dispatch queue for viewport-gated translation work (#1881's
 * successor). The intersection observer decides which paragraphs the reader is
 * *approaching*; this queue decides when they are actually translated:
 *
 * - in bounded slices, with a yield between insertions, so a burst of
 *   paragraphs never becomes one long task on the main thread;
 * - during idle slices only (`requestIdleCallback` where available, a timer
 *   elsewhere), so scrolling and input win over speculative translation;
 * - never while the document is hidden, resuming on return, so a tab the
 *   reader left cannot keep burning CPU, network or API quota;
 * - only once `isEligible` says the reader is close enough, so a unit queued
 *   from far down the page waits instead of being translated early.
 *
 * `isEligible` is re-checked at dispatch time, not at enqueue time: a page that
 * grows between queueing and dispatch (translated wrappers do) can push a unit
 * back out of reach, and the queue must honour the reader's current position.
 */
export function createLazyDispatchQueue(options: LazyDispatchOptions): LazyDispatchQueue {
  const {
    run,
    isEligible,
    shouldContinue = () => true,
    beforeSlice,
    maxUnitsPerSlice = LAZY_DISPATCH_MAX_UNITS_PER_SLICE,
  } = options

  const pending: HTMLElement[] = []
  const queued = new Set<HTMLElement>()
  let stopped = true
  let idleHandle: number | null = null
  let timerHandle: number | null = null

  const isLive = (): boolean => !stopped && shouldContinue()

  const clearSchedule = (): void => {
    const host = globalThis as IdleCallbackHost
    if (idleHandle !== null) {
      host.cancelIdleCallback?.(idleHandle)
      idleHandle = null
    }
    if (timerHandle !== null) {
      clearTimeout(timerHandle)
      timerHandle = null
    }
  }

  const arm = (): void => {
    if (!isLive() || idleHandle !== null || timerHandle !== null) return
    const host = globalThis as IdleCallbackHost
    if (typeof host.requestIdleCallback === "function") {
      idleHandle = host.requestIdleCallback(
        (deadline) => {
          idleHandle = null
          void drain(deadline)
        },
        { timeout: IDLE_SLICE_TIMEOUT_MS },
      )
      return
    }
    timerHandle = window.setTimeout(() => {
      timerHandle = null
      void drain(null)
    }, 0)
  }

  const drain = async (deadline: IdleDeadlineLike | null): Promise<void> => {
    if (!isLive() || document.hidden) return

    let dispatched = 0
    // Distinguishes "this slice ran out of time" (keep slicing) from "the
    // reader has not reached the next unit" (wait for the viewport to move).
    // Conflating them strands the queue: a busy page hands out idle callbacks
    // with almost no time remaining, so a slice can dispatch nothing and the
    // next one is only ever scheduled by an event that never comes.
    let waitingForReader = false
    let slicePrepared = false
    while (dispatched < maxUnitsPerSlice && pending.length > 0 && isLive() && !document.hidden) {
      if (deadline && !deadline.didTimeout && deadline.timeRemaining() <= MIN_SLICE_TIME_MS) break

      const unit = pending[0]!
      if (!unit.isConnected) {
        pending.shift()
        queued.delete(unit)
        continue
      }
      // The queue holds units in document order, so an out-of-reach head means
      // everything behind it is out of reach too — stop this slice instead of
      // scanning. Viewport listeners re-arm once the reader moves.
      if (!isEligible(unit)) {
        waitingForReader = true
        break
      }

      // Slice setup runs only when there is something to dispatch: an
      // out-of-reach queue must not spend a storage read per idle callback.
      if (!slicePrepared) {
        slicePrepared = true
        try {
          await beforeSlice?.()
        } catch (error) {
          logger.warn("Lazy dispatch slice setup failed:", error)
        }
      }

      pending.shift()
      queued.delete(unit)
      dispatched += 1

      // Started, not awaited: the units the reader can see must translate
      // concurrently — request pacing belongs to the background queue, whose
      // rate/capacity semantics are unchanged. The slice still yields between
      // insertions so a burst of units never becomes one long task.
      try {
        void run(unit).catch((error) => {
          logger.warn("Lazy dispatch failed for a queued unit:", error)
        })
      } catch (error) {
        logger.warn("Lazy dispatch failed for a queued unit:", error)
      }
      await yieldToMain()
    }

    if (pending.length > 0 && !waitingForReader) arm()
  }

  const onVisibilityChange = (): void => {
    if (!document.hidden) arm()
  }

  const onViewportChange = (): void => {
    if (pending.length > 0) arm()
  }

  return {
    enqueue(units: Iterable<HTMLElement>): void {
      if (stopped) return
      let added = false
      for (const unit of units) {
        if (!unit.isConnected || queued.has(unit)) continue
        queued.add(unit)
        pending.push(unit)
        added = true
      }
      if (added) arm()
    },

    start(): void {
      if (!stopped) return
      stopped = false
      document.addEventListener("visibilitychange", onVisibilityChange)
      window.addEventListener("scroll", onViewportChange, { passive: true, capture: true })
      window.addEventListener("resize", onViewportChange, { passive: true })
      arm()
    },

    stop(): void {
      stopped = true
      clearSchedule()
      pending.length = 0
      queued.clear()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("scroll", onViewportChange, { capture: true })
      window.removeEventListener("resize", onViewportChange)
    },

    get pendingCount(): number {
      return pending.length
    },
  }
}
