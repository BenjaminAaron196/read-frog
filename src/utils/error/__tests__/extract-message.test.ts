import { describe, expect, it } from "vitest"
import { extractAISDKErrorMessage } from "../extract-message"

describe("provider error surface", () => {
  it("summarizes an HTML block page instead of dumping its markup", () => {
    const body =
      "<!DOCTYPE html><html><head><title>Loading</title></head><body><h1>Blocked</h1></body></html>"
    const message = extractAISDKErrorMessage(
      Object.assign(new Error("Bad Request"), { responseBody: body }),
    )

    expect(message).toContain("HTML page instead of a model reply (Loading)")
    expect(message).not.toContain("<html>")
  })

  it("summarizes HTML that arrived as the error message itself", () => {
    const message = extractAISDKErrorMessage(new Error("<html><title>Error</title></html>"))

    expect(message).toContain("HTML page instead of a model reply (Error)")
  })

  it("keeps a provider's JSON reason readable and bounded", () => {
    const body = `{"error":{"message":"${"x".repeat(900)}"}}`
    const message = extractAISDKErrorMessage(
      Object.assign(new Error("Too Many Requests"), { statusCode: 429, responseBody: body }),
    )

    expect(message.length).toBeLessThanOrEqual(401)
    expect(message.endsWith("…")).toBe(true)
  })
})
