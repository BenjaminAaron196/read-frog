// @vitest-environment jsdom

import type { LearningDictionaryEntry, LearningProfile } from "../types"
import { describe, expect, it } from "vitest"
import { LearningHighlighter } from "../highlighter"
import { createWordMatcher } from "../lookup"
import { startViewportScanning } from "../viewport-scanner"

const PROFILE: LearningProfile = { kind: "cefr", exam: "cet6", cefrLevel: "B1", vocabSize: 8000 }

const ENTRIES: LearningDictionaryEntry[] = [
  { w: "chancellor", cefr: "B2", frq: 11335 },
  { w: "coalition", cefr: "B2", frq: 2241 },
]

/** One macrotask, with no wall-clock timer behind it. */
function macrotask(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  const channel = new MessageChannel()
  channel.port1.onmessage = () => {
    channel.port1.close()
    resolve()
  }
  channel.port2.postMessage(null)
  return promise
}

/**
 * jsdom has no IntersectionObserver, so the scanner takes its one-pass path -
 * which is exactly the path that decides what counts as a reading unit. The pass
 * is chained off promises and yields to the main thread between slices, so the
 * marks land a few macrotasks later; draining them is the wait, not a sleep.
 */
async function scan(body: string): Promise<string[]> {
  document.body.innerHTML = body
  const highlighter = new LearningHighlighter()
  const index = {
    byWord: new Map(ENTRIES.map((entry) => [entry.w, entry])),
    byLemma: new Map<string, LearningDictionaryEntry>(),
  }
  const scanner = startViewportScanning({
    matcher: createWordMatcher({ index, profile: PROFILE, suppressedWords: new Set<string>() }),
    highlighter,
    maxHighlights: 100,
    shouldContinue: () => true,
  })
  for (let tick = 0; tick < 20; tick += 1) await macrotask()
  const surfaces = highlighter.occurrencesSnapshot.map((occurrence) => occurrence.surface)
  scanner.stop()
  return surfaces
}

describe("viewport scanner", () => {
  it("marks the words in a paragraph element", async () => {
    expect(await scan("<p>the chancellor met the coalition</p>")).toEqual([
      "chancellor",
      "coalition",
    ])
  })

  it("marks the words in a div that is its own paragraph", async () => {
    // Reuters renders its article body as `<div data-testid="paragraph">`.
    expect(
      await scan('<div data-testid="paragraph">the chancellor met the coalition</div>'),
    ).toEqual(["chancellor", "coalition"])
  })

  it("reaches a paragraph inside a container without scanning the container", async () => {
    expect(
      await scan(
        '<div class="article"><div data-testid="paragraph">the chancellor</div><p>the coalition</p></div>',
      ),
    ).toEqual(["chancellor", "coalition"])
  })

  it("leaves a div that only wraps other blocks to its children", async () => {
    // A div holding blocks is layout, not prose: walking it would pull its whole
    // subtree into one scan, which is the pass the viewport policy avoids.
    expect(await scan('<div id="wrap"><div class="row"><p>the chancellor</p></div></div>')).toEqual(
      ["chancellor"],
    )
  })
})
