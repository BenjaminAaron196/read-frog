// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { extractSentence, extractSentenceFromNode } from "../sentence"

describe("extractSentence", () => {
  it("returns the sentence around the match", () => {
    const text = "First one. The reader noticed a familiar word here. Third one."
    const start = text.indexOf("familiar")
    expect(extractSentence(text, start, start + "familiar".length)).toBe(
      "The reader noticed a familiar word here.",
    )
  })

  it("stops at a line break", () => {
    expect(extractSentence("alpha\nbeta gamma\n", 6, 10)).toBe("beta gamma")
  })
})

describe("extractSentenceFromNode", () => {
  it("keeps the text node's own sentence when it is long enough", () => {
    const paragraph = document.createElement("p")
    paragraph.textContent =
      "A whole sentence lives in one text node, and it is comfortably long enough to be the context."
    document.body.append(paragraph)
    const node = paragraph.firstChild as Text

    expect(extractSentenceFromNode(node, 0, 1)).toContain("comfortably long enough")
    paragraph.remove()
  })

  it("falls back to the enclosing block when the node is a fragment", () => {
    const paragraph = document.createElement("p")
    paragraph.innerHTML =
      'Readers meet <a href="#">lexicography</a> in a sentence that continues well past the link.'
    document.body.append(paragraph)
    const linkNode = paragraph.querySelector("a")?.firstChild as Text

    // The link's own text is one word, so the paragraph is the useful context.
    expect(extractSentenceFromNode(linkNode, 0, linkNode.data.length)).toBe(paragraph.textContent)
    paragraph.remove()
  })
})
