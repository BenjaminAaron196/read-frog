import { describe, expect, it } from "vitest"
import { resolvePromptIdForRequest, SMART_TRANSLATE_PROMPT_ID } from "../style-router"
import { rememberStyleVerdict } from "../style-verdict"

/**
 * The verdict is a model's answer, taken once per URL. Routing is only reading
 * it: nothing here may classify on its own, or the two sides of a translation
 * would build different prompts.
 */
describe("resolvePromptIdForRequest", () => {
  it("passes an explicit choice through untouched", () => {
    rememberStyleVerdict("https://example.com/", "news")
    expect(resolvePromptIdForRequest("gaming", { url: "https://example.com/" }, "default")).toBe(
      "gaming",
    )
  })

  it("uses the page's verdict when the reader asked for smart", () => {
    rememberStyleVerdict("https://news.example/article", "news")
    expect(
      resolvePromptIdForRequest(
        SMART_TRANSLATE_PROMPT_ID,
        { url: "https://news.example/article" },
        "default",
      ),
    ).toBe("news")
  })

  it("stays on the default while the verdict is unknown", () => {
    expect(
      resolvePromptIdForRequest(
        SMART_TRANSLATE_PROMPT_ID,
        { url: "https://never-classified.example/" },
        "default",
      ),
    ).toBe("default")
  })

  it("stays on the default when the model named no genre", () => {
    rememberStyleVerdict("https://plain.example/", null)
    expect(
      resolvePromptIdForRequest(
        SMART_TRANSLATE_PROMPT_ID,
        { url: "https://plain.example/" },
        "default",
      ),
    ).toBe("default")
  })
})
