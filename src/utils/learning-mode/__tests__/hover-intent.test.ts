import { describe, expect, it } from "vitest"
import {
  createHoverIntent,
  decideHover,
  HOVER_SWITCH_DELAY_MS,
  type HoverIntent,
  type HoverObservation,
} from "../hover-intent"

function observe(overrides: Partial<HoverObservation> = {}): HoverObservation {
  return {
    occurrenceId: null,
    now: 1000,
    isPointerOverCard: false,
    isWithinOpenWordRect: false,
    ...overrides,
  }
}

describe("decideHover", () => {
  it("switches once the delay has elapsed, even if the pointer stopped moving", () => {
    const first = decideHover(createHoverIntent(), observe({ occurrenceId: 1, now: 0 }))
    expect(first.action).toBe("open")
    const candidate = decideHover(first.intent, observe({ occurrenceId: 2, now: 100 }))
    expect(candidate.action).toBe("keep")
    const settled = decideHover(
      candidate.intent,
      observe({ occurrenceId: 2, now: 100 + HOVER_SWITCH_DELAY_MS }),
    )
    expect(settled.action).toBe("switch")
  })

  it("opens on the first mark and keeps it while the pointer stays on it", () => {
    const first = decideHover(createHoverIntent(), observe({ occurrenceId: 7 }))
    expect(first.action).toBe("open")
    expect(first.intent.occurrenceId).toBe(7)

    const again = decideHover(first.intent, observe({ occurrenceId: 7, now: 1200 }))
    expect(again.action).toBe("keep")
    expect(again.intent.occurrenceId).toBe(7)
  })

  it("follows the pointer to another copy of the same word", () => {
    // The same headword appears many times on a page; the card belongs to the
    // copy under the pointer, not to the word.
    const opened = decideHover(createHoverIntent(), observe({ occurrenceId: 7, now: 1000 }))
    const other = decideHover(opened.intent, observe({ occurrenceId: 9, now: 1100 }))
    expect(other.action).toBe("keep")

    const settled = decideHover(
      other.intent,
      observe({ occurrenceId: 9, now: 1100 + HOVER_SWITCH_DELAY_MS }),
    )
    expect(settled.action).toBe("switch")
    expect(settled.intent.occurrenceId).toBe(9)
  })

  it("keeps the card when the caret misses the word the pointer is visually on", () => {
    // The trailing half of a word resolves past it, so the caret comes back
    // empty while the pointer never left.
    const opened = decideHover(createHoverIntent(), observe({ occurrenceId: 7 }))
    const missed = decideHover(
      opened.intent,
      observe({ occurrenceId: null, isWithinOpenWordRect: true }),
    )
    expect(missed.action).toBe("keep")
    expect(missed.intent.occurrenceId).toBe(7)
  })

  it("keeps the card when the caret resolves to the neighbour of a mark the pointer is still on", () => {
    const opened = decideHover(createHoverIntent(), observe({ occurrenceId: 7 }))
    const neighbour = decideHover(
      opened.intent,
      observe({ occurrenceId: 8, isWithinOpenWordRect: true }),
    )
    expect(neighbour.action).toBe("keep")
    expect(neighbour.intent.occurrenceId).toBe(7)
  })

  it("never takes the card away while the pointer is on it", () => {
    const opened = decideHover(createHoverIntent(), observe({ occurrenceId: 7 }))
    const onCard = decideHover(
      opened.intent,
      observe({ occurrenceId: null, isPointerOverCard: true }),
    )
    expect(onCard.action).toBe("keep")
    expect(onCard.intent.occurrenceId).toBe(7)
  })

  it("waits out a shorter neighbour before switching", () => {
    const opened = decideHover(createHoverIntent(), observe({ occurrenceId: 7, now: 1000 }))
    const neighbour = decideHover(opened.intent, observe({ occurrenceId: 8, now: 1100 }))
    expect(neighbour.action).toBe("keep")
    expect(neighbour.intent.occurrenceId).toBe(7)

    const settled = decideHover(
      neighbour.intent,
      observe({ occurrenceId: 8, now: 1100 + HOVER_SWITCH_DELAY_MS }),
    )
    expect(settled.action).toBe("switch")
    expect(settled.intent.occurrenceId).toBe(8)
  })

  it("forgets a candidate the pointer only crossed", () => {
    const opened = decideHover(createHoverIntent(), observe({ occurrenceId: 7, now: 1000 }))
    const crossed = decideHover(opened.intent, observe({ occurrenceId: 8, now: 1050 }))
    const back = decideHover(crossed.intent, observe({ occurrenceId: 7, now: 1080 }))
    expect(back.intent.candidateId).toBe(null)

    // The same neighbour later still needs its own full delay...
    const revisits = decideHover(back.intent, observe({ occurrenceId: 8, now: 1200 }))
    expect(revisits.action).toBe("keep")
    // ...measured from that visit, not from the first one.
    const early = decideHover(
      revisits.intent,
      observe({ occurrenceId: 8, now: 1200 + HOVER_SWITCH_DELAY_MS - 20 }),
    )
    expect(early.action).toBe("keep")
    const late = decideHover(
      revisits.intent,
      observe({ occurrenceId: 8, now: 1200 + HOVER_SWITCH_DELAY_MS }),
    )
    expect(late.action).toBe("switch")
  })

  it("hides only when the pointer left both the word and the card", () => {
    const opened = decideHover(createHoverIntent(), observe({ occurrenceId: 7 }))
    const away = decideHover(
      opened.intent,
      observe({ occurrenceId: null, isWithinOpenWordRect: false }),
    )
    expect(away.action).toBe("hide")
    expect(away.intent.occurrenceId).toBe(null)
  })

  it("opens straight away once the card was hidden", () => {
    const fresh: HoverIntent = createHoverIntent()
    expect(decideHover(fresh, observe({ occurrenceId: 3 })).action).toBe("open")
  })
})
