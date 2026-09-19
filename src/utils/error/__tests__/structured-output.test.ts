import { describe, expect, it } from "vitest"
import { isStructuredOutputUnsupportedError } from "../structured-output"

describe("structured output support detection", () => {
  it("recognizes the relay that refuses response_format", () => {
    const error = Object.assign(new Error("Upstream request failed"), {
      statusCode: 400,
      responseBody:
        '{"error":{"message":"Error from provider (Console Go): Upstream request failed: [invalid_request_error] This response_format type is unavailable now"}}',
    })

    expect(isStructuredOutputUnsupportedError(error)).toBe(true)
  })

  it("recognizes the same refusal after the SDK collapsed it into a message", () => {
    expect(
      isStructuredOutputUnsupportedError(
        new Error(
          "Failed after 2 attempts with non-retryable error: 'AI_APICallError: Error from provider (Console Go): Upstream request failed: [invalid_request_error] This response_format type is unavailable now'",
        ),
      ),
    ).toBe(true)
  })

  it("leaves unrelated failures alone", () => {
    expect(
      isStructuredOutputUnsupportedError(
        Object.assign(new Error("Invalid URL"), { statusCode: 400, responseBody: "Invalid URL" }),
      ),
    ).toBe(false)
    expect(
      isStructuredOutputUnsupportedError(
        Object.assign(new Error("response_format is unavailable"), { statusCode: 500 }),
      ),
    ).toBe(false)
    expect(isStructuredOutputUnsupportedError(new Error("response_format"))).toBe(false)
    expect(isStructuredOutputUnsupportedError(undefined)).toBe(false)
  })
})
