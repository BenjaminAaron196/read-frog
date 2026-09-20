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
    word: null,
    now: 1000,
    isPointerOverCard: false,
    isWithinOpenWordRect: false,
    ...overrides,
  }
}

describe("decideHover", () => {
  it("switches once the delay has elapsed, even if the pointer stopped moving", () => {
    const first = decideHover(createHoverIntent(), observe({ word: "language", now: 0 }))
    expect(first.action).toBe("open")
    const candidate = decideHover(first.intent, observe({ word: "acquisition", now: 100 }))
    expect(candidate.action).toBe("keep")
    const settled = decideHover(
      candidate.intent,
      observe({ word: "acquisition", now: 100 + HOVER_SWITCH_DELAY_MS }),
    )
    expect(settled.action).toBe("switch")
  })

  it("opens on the first word and keeps it while the pointer stays on it", () => {
    const first = decideHover(createHoverIntent(), observe({ word: "acquisition" }))
    expect(first.action).toBe("open")
    expect(first.intent.word).toBe("acquisition")

    const again = decideHover(first.intent, observe({ word: "acquisition", now: 1200 }))
    expect(again.action).toBe("keep")
    expect(again.intent.word).toBe("acquisition")
  })

  it("keeps the card when the caret misses the word the pointer is visually on", () => {
    // The trailing half of a word resolves past it, so the caret comes back
    // empty while the pointer never left.
    const opened = decideHover(createHoverIntent(), observe({ word: "acquisition" }))
    const missed = decideHover(opened.intent, observe({ word: null, isWithinOpenWordRect: true }))
    expect(missed.action).toBe("keep")
    expect(missed.intent.word).toBe("acquisition")
  })

  it("never takes the card away while the pointer is on it", () => {
    const opened = decideHover(createHoverIntent(), observe({ word: "acquisition" }))
    const onCard = decideHover(opened.intent, observe({ word: null, isPointerOverCard: true }))
    expect(onCard.action).toBe("keep")
    expect(onCard.intent.word).toBe("acquisition")
  })

  it("waits out a shorter neighbour before switching", () => {
    const opened = decideHover(createHoverIntent(), observe({ word: "acquisition", now: 1000 }))
    const neighbour = decideHover(opened.intent, observe({ word: "language", now: 1100 }))
    expect(neighbour.action).toBe("keep")
    expect(neighbour.intent.word).toBe("acquisition")

    const settled = decideHover(
      neighbour.intent,
      observe({ word: "language", now: 1100 + HOVER_SWITCH_DELAY_MS }),
    )
    expect(settled.action).toBe("switch")
    expect(settled.intent.word).toBe("language")
  })

  it("forgets a candidate the pointer only crossed", () => {
    const opened = decideHover(createHoverIntent(), observe({ word: "acquisition", now: 1000 }))
    const crossed = decideHover(opened.intent, observe({ word: "language", now: 1050 }))
    const back = decideHover(crossed.intent, observe({ word: "acquisition", now: 1080 }))
    expect(back.intent.candidateWord).toBe(null)

    // The same neighbour later still needs its own full delay...
    const revisits = decideHover(back.intent, observe({ word: "language", now: 1200 }))
    expect(revisits.action).toBe("keep")
    // ...measured from that visit, not from the first one.
    const early = decideHover(
      revisits.intent,
      observe({ word: "language", now: 1200 + HOVER_SWITCH_DELAY_MS - 20 }),
    )
    expect(early.action).toBe("keep")
    const late = decideHover(
      revisits.intent,
      observe({ word: "language", now: 1200 + HOVER_SWITCH_DELAY_MS }),
    )
    expect(late.action).toBe("switch")
  })

  it("hides only when the pointer left both the word and the card", () => {
    const opened = decideHover(createHoverIntent(), observe({ word: "acquisition" }))
    const away = decideHover(opened.intent, observe({ word: null, isWithinOpenWordRect: false }))
    expect(away.action).toBe("hide")
    expect(away.intent.word).toBe(null)
  })

  it("opens straight away once the card was hidden", () => {
    const fresh: HoverIntent = createHoverIntent()
    expect(decideHover(fresh, observe({ word: "language" })).action).toBe("open")
  })
})
