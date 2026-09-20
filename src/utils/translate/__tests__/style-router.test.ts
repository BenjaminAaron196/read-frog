import { describe, expect, it } from "vitest"
import {
  classifyTranslateStyle,
  resolvePromptIdForRequest,
  SMART_TRANSLATE_PROMPT_ID,
} from "../style-router"

describe("classifyTranslateStyle", () => {
  it("names a genre the title states", () => {
    expect(classifyTranslateStyle({ title: "Reuters: Saudi civil defence sends all clear" })).toBe(
      "news",
    )
    expect(classifyTranslateStyle({ title: "Patch 2.4 gameplay changes" })).toBe("gaming")
    expect(classifyTranslateStyle({ title: "API reference — Docs" })).toBe("tech-docs")
  })

  it("falls back to the passage when the title says nothing", () => {
    expect(
      classifyTranslateStyle({
        title: "Something",
        input: "We propose a new method. Abstract: this paper studies et al. Figure 3 shows",
      }),
    ).toBe("academic")
  })

  it("stays silent when nothing names a genre", () => {
    // A guess here would change the prompt - and with it the cache key - for
    // every ordinary page.
    expect(classifyTranslateStyle({ title: "Home", input: "Hello, how are you today?" })).toBe(null)
  })
})

describe("resolvePromptIdForRequest", () => {
  it("passes an explicit choice through untouched", () => {
    expect(resolvePromptIdForRequest("news", { title: "Reuters" }, "default")).toBe("news")
  })

  it("resolves smart to the genre it recognises", () => {
    expect(
      resolvePromptIdForRequest(SMART_TRANSLATE_PROMPT_ID, { title: "Patch notes" }, "default"),
    ).toBe("gaming")
  })

  it("resolves smart to the default when nothing is recognised", () => {
    expect(resolvePromptIdForRequest(SMART_TRANSLATE_PROMPT_ID, { title: "Home" }, "default")).toBe(
      "default",
    )
  })
})
