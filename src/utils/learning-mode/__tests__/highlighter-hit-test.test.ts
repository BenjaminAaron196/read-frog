// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { LearningHighlighter } from "../highlighter"

function markWord(text: string, word: string) {
  const host = document.createElement("p")
  host.textContent = text
  document.body.append(host)
  const node = host.firstChild as Text
  const start = text.indexOf(word)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + word.length)
  // jsdom has no layout, so the box the rule checks is stubbed per range.
  range.getBoundingClientRect = () => ({ left: 100, right: 160, top: 10, bottom: 30 }) as DOMRect
  const highlighter = new LearningHighlighter()
  highlighter.add(
    range,
    {
      tier: "tier1",
      surface: word,
      entry: { w: word },
    },
    text,
  )
  return { highlighter, node, start, word }
}

describe("LearningHighlighter.hitTest", () => {
  it("hits a word the caret is inside", () => {
    const { highlighter, node, start } = markWord("the voters solved it", "solved")
    expect(highlighter.hitTest(node, start + 1, { x: 120, y: 20 })?.surface).toBe("solved")
  })

  it("hits the trailing edge when the pointer is on the word", () => {
    const { highlighter, node, start } = markWord("the voters solved it", "solved")
    // The caret resolves just after the word when the pointer sits on its right half.
    expect(highlighter.hitTest(node, start + 6, { x: 158, y: 20 })?.surface).toBe("solved")
  })

  it("refuses the trailing edge when the pointer is elsewhere", () => {
    // Chromium clamps a caret in empty space to the nearest text position, so the
    // end of a line resolves to the end of its last word.
    const { highlighter, node, start } = markWord("the voters solved it", "solved")
    expect(highlighter.hitTest(node, start + 6, { x: 900, y: 20 })).toBe(null)
  })
})
