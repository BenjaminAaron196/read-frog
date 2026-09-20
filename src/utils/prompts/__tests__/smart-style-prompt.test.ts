import { describe, expect, it, vi } from "vitest"

vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: vi.fn<() => Promise<null>>(async () => null),
}))

import { rememberStyleVerdict } from "@/utils/translate/style-verdict"
import { getTranslatePromptFromConfig } from "../translate"

const configWith = (promptId: string) =>
  ({
    customPromptsConfig: { promptId, patterns: [] },
  }) as never

describe("smart style selection in the page prompt builder", () => {
  it("builds the genre prompt the page's verdict names", () => {
    // The verdict is the model's, taken once per URL by the background; the
    // builder only reads it, which is what keeps both sides on one prompt.
    rememberStyleVerdict("https://news.example/article", "news")
    const result = getTranslatePromptFromConfig(configWith("smart"), "cmn", "The report said", {
      context: { url: "https://news.example/article", webTitle: "Reuters: ceasefire holds" },
    })

    expect(result.systemPrompt).toContain("News Translator")
  })

  it("builds the default prompt when nothing names a genre", () => {
    const result = getTranslatePromptFromConfig(configWith("smart"), "cmn", "Hello there", {
      context: { url: "https://plain.example/", webTitle: "Home" },
    })

    expect(result.systemPrompt).not.toContain("News Translator")
    expect(result.systemPrompt).toContain("native translator")
  })

  it("passes an explicit style through untouched", () => {
    const result = getTranslatePromptFromConfig(configWith("gaming"), "cmn", "Patch notes", {
      context: { url: "https://plain.example/", webTitle: "Home" },
    })

    expect(result.systemPrompt).toContain("Games Community Translator")
  })

  it("keeps the built-in for an id a custom prompt also uses", () => {
    const config = {
      customPromptsConfig: {
        promptId: "smart",
        patterns: [
          {
            id: "news",
            name: "Mine",
            systemPrompt: "MY NEWS PROMPT",
            prompt: "{{input}}",
          },
        ],
      },
    }

    rememberStyleVerdict("https://news.example/other", "news")
    const result = getTranslatePromptFromConfig(config, "cmn", "The report said", {
      context: { url: "https://news.example/other", webTitle: "Reuters: ceasefire holds" },
    })

    // The repository's precedence is built-in, then custom, then default - a
    // style id resolves to the style, and a reader who wants their own news
    // prompt gives it a different id and selects it.
    expect(result.systemPrompt).toContain("News Translator")
    expect(result.systemPrompt).not.toContain("MY NEWS PROMPT")
  })
})
