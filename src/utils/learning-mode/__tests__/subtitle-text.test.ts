import { describe, expect, it } from "vitest"
import { normalizeToken, type WordMatcher } from "../lookup"
import { markSubtitleText, tokenizeSubtitle } from "../subtitle-text"

/** A matcher that marks exactly the words it was given, with a fixed tier. */
function matcherFor(words: Record<string, "tier1" | "tier2" | "tier3">): WordMatcher {
  return (rawToken) => {
    const tier = words[normalizeToken(rawToken)]
    if (!tier) return null
    return { tier, surface: rawToken, entry: { w: rawToken.toLowerCase() } }
  }
}

function render(text: string, matcher: WordMatcher): string {
  return markSubtitleText(text, matcher)
    .map((token) => (token.kind === "word" && token.match ? `[${token.text}]` : token.text))
    .join("")
}

describe("tokenizeSubtitle", () => {
  it("keeps punctuation and spacing exactly where they were", () => {
    const text = "Well, that's it - isn't it?"
    expect(
      tokenizeSubtitle(text)
        .map((token) => token.text)
        .join(""),
    ).toBe(text)
  })

  it("keeps a hyphenated word and a number whole", () => {
    const words = tokenizeSubtitle("far-right 2029").filter((token) => token.kind === "word")
    expect(words.map((token) => token.text)).toEqual(["far-right", "2029"])
  })

  it("walks letters that are not Latin", () => {
    const tokens = tokenizeSubtitle("完全不一样")
    expect(tokens).toEqual([{ kind: "word", text: "完全不一样", match: null }])
  })
})

describe("markSubtitleText", () => {
  it("marks only the words the profile named", () => {
    const matcher = matcherFor({ chancellor: "tier1", coalition: "tier2" })
    expect(render("the chancellor met a coalition, today.", matcher)).toBe(
      "the [chancellor] met a [coalition], today.",
    )
  })

  it("marks a possessive by the word it belongs to", () => {
    const matcher = matcherFor({ houthis: "tier3" })
    expect(render("the Houthis' claim", matcher)).toBe("the [Houthis]' claim")
  })

  it("leaves a line with nothing to mark untouched", () => {
    const matcher = matcherFor({})
    const text = "the voters went home"
    expect(render(text, matcher)).toBe(text)
  })
})
