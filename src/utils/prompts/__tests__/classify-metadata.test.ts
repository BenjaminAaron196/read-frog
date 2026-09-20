import { describe, expect, it } from "vitest"
import { hasClassifiableMetadata } from "../translate-style"

describe("hasClassifiableMetadata", () => {
  it("refuses the shell page a news site serves before it hydrates", () => {
    expect(
      hasClassifiableMetadata({
        url: "https://www.reuters.com/world/middle-east/article-2026-09-19/",
        title: "reuters.com",
        description: "",
      }),
    ).toBe(false)
  })

  it("accepts the hydrated page", () => {
    expect(
      hasClassifiableMetadata({
        url: "https://www.reuters.com/world/middle-east/article-2026-09-19/",
        title: "Flames, smoke seen near Riyadh airport; Houthis claim attacks | Reuters",
        description: "",
      }),
    ).toBe(true)
  })

  it("accepts a page that only describes itself", () => {
    expect(
      hasClassifiableMetadata({
        url: "https://news.example/x",
        title: "x",
        description: "Saudi civil defence said an all-clear was issued.",
      }),
    ).toBe(true)
  })

  it("refuses an empty page", () => {
    expect(
      hasClassifiableMetadata({ url: "https://example.com/", title: "", description: "" }),
    ).toBe(false)
  })
})
