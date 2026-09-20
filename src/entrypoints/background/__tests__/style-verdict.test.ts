import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The background half of the smart style: one model call per URL, parsed to a
 * style id and remembered, so the content script that hashes a paragraph and the
 * background that translates it read the same answer.
 */
type GenerateText = (payload: unknown) => Promise<string>

const generateText = vi.fn<GenerateText>()
const config = {
  pageTranslation: { providerId: "llm", customPromptsConfig: { promptId: "smart", patterns: [] } },
  providersConfig: [
    { id: "llm", provider: "openai-compatible", enabled: true, model: { modelId: "m" } },
  ],
}

vi.mock("@/utils/config/storage", () => ({
  getLocalConfig: vi.fn<() => Promise<typeof config>>(async () => config),
}))
vi.mock("@/types/config/provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/types/config/provider")>()),
  isLLMProviderConfig: () => true,
}))
vi.mock("../background-stream", () => ({
  generateTextForProviderRef: (payload: unknown) => generateText(payload),
}))
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn<(...args: unknown[]) => void>(),
    warn: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const { classifyStyleVerdict } = await import("../learning-mode")
const { styleVerdictFor } = await import("@/utils/translate/style-verdict")

describe("classifyStyleVerdict", () => {
  beforeEach(() => {
    generateText.mockReset()
  })

  it("asks the model once per URL and remembers the answer", async () => {
    generateText.mockResolvedValue("news")
    const url = "https://news.example/one"

    expect(await classifyStyleVerdict({ url, title: "Reuters", description: null })).toBe("news")
    expect(await classifyStyleVerdict({ url, title: "Reuters", description: null })).toBe("news")

    expect(generateText).toHaveBeenCalledTimes(1)
    expect(styleVerdictFor(url)).toBe("news")
  })

  it("reads an answer that names no genre as the default", async () => {
    generateText.mockResolvedValue("default")
    const url = "https://plain.example/two"
    expect(await classifyStyleVerdict({ url, title: "Home", description: null })).toBe(null)
    expect(styleVerdictFor(url)).toBe(null)
  })

  it("does not pin a page to the default when the model call fails", async () => {
    generateText.mockRejectedValue(new Error("network"))
    const url = "https://flaky.example/three"
    expect(await classifyStyleVerdict({ url, title: "x", description: null })).toBe(null)
    // Unknown, not settled: a later attempt may still classify this page.
    expect(styleVerdictFor(url)).toBeUndefined()
  })
})
