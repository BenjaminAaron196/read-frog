import { describe, expect, it, vi } from "vitest"

vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: vi.fn<() => Promise<null>>(async () => null),
}))

import { getTranslatePromptFromConfig } from "../translate"

const configWith = (promptId: string) =>
  ({
    customPromptsConfig: { promptId, patterns: [] },
  }) as never

describe("smart style selection in the page prompt builder", () => {
  it("builds the genre prompt the page names", () => {
    const result = getTranslatePromptFromConfig(configWith("smart"), "cmn", "The report said", {
      context: { webTitle: "Reuters: ceasefire holds", webDescription: "" },
    })

    expect(result.systemPrompt).toContain("News Translator")
  })

  it("builds the default prompt when nothing names a genre", () => {
    const result = getTranslatePromptFromConfig(configWith("smart"), "cmn", "Hello there", {
      context: { webTitle: "Home", webDescription: "" },
    })

    expect(result.systemPrompt).not.toContain("News Translator")
    expect(result.systemPrompt).toContain("native translator")
  })

  it("passes an explicit style through untouched", () => {
    const result = getTranslatePromptFromConfig(configWith("gaming"), "cmn", "Patch notes", {
      context: { webTitle: "Home", webDescription: "" },
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

    const result = getTranslatePromptFromConfig(config, "cmn", "The report said", {
      context: { webTitle: "Reuters: ceasefire holds", webDescription: "" },
    })

    // The repository's precedence is built-in, then custom, then default - a
    // style id resolves to the style, and a reader who wants their own news
    // prompt gives it a different id and selects it.
    expect(result.systemPrompt).toContain("News Translator")
    expect(result.systemPrompt).not.toContain("MY NEWS PROMPT")
  })
})
