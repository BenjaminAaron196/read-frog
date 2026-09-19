import { describe, expect, it, vi } from "vitest"
import { isRetryableApiError, runWithApiRetry } from "../api-retry"

function apiError(statusCode: number, body = "boom") {
  return Object.assign(new Error(body), { name: "AI_APICallError", statusCode, responseBody: body })
}

describe("api retry", () => {
  it("rethrows the provider's own error so its status and body survive", async () => {
    const failure = apiError(503, "no available channel")
    const run = vi.fn<() => Promise<never>>(async () => {
      throw failure
    })

    await expect(runWithApiRetry(run, { delayMs: () => 0 })).rejects.toBe(failure)
    expect(run).toHaveBeenCalledTimes(3)
    await expect(runWithApiRetry(run, { delayMs: () => 0 }).catch((error) => error)).resolves.toBe(
      failure,
    )
  })

  it("stops retrying once the caller can no longer accept a retry", async () => {
    let posted = false
    const run = vi.fn<() => Promise<never>>(async () => {
      posted = true
      throw apiError(500)
    })

    await expect(
      runWithApiRetry(run, { delayMs: () => 0, canRetry: () => !posted }),
    ).rejects.toMatchObject({ statusCode: 500 })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("does not retry a client error the provider will answer the same way", async () => {
    const run = vi.fn<() => Promise<never>>(async () => {
      throw apiError(400, "Invalid URL")
    })

    await expect(runWithApiRetry(run, { delayMs: () => 0 })).rejects.toMatchObject({
      statusCode: 400,
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("returns the first success and stops retrying", async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce("好的")

    await expect(runWithApiRetry(run, { delayMs: () => 0 })).resolves.toBe("好的")
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("treats a transient status and a plain network failure as retryable", () => {
    expect(isRetryableApiError(apiError(429))).toBe(true)
    expect(isRetryableApiError(apiError(502))).toBe(true)
    expect(isRetryableApiError(apiError(404, "Invalid URL"))).toBe(false)
    expect(isRetryableApiError(new TypeError("Failed to fetch"))).toBe(true)
    expect(isRetryableApiError(new DOMException("stopped", "AbortError"))).toBe(false)
  })
})
