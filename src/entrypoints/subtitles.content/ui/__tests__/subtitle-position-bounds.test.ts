import { describe, expect, it } from "vitest"
import { sanitizePercent } from "../use-vertical-drag"

/**
 * The percent is written straight into `top`/`bottom`, and the drag grip is the
 * only way back: a percent that is not a finite number produces invalid CSS (the
 * box stops answering the pointer), and one that ignores the grip parks the
 * handle outside the player.
 */
describe("sanitizePercent", () => {
  it("keeps a percent inside the range the player allows", () => {
    expect(sanitizePercent(42, 80)).toBe(42)
    expect(sanitizePercent(-5, 80)).toBe(0)
    expect(sanitizePercent(200, 80)).toBe(80)
  })

  it("never returns a value the style cannot use", () => {
    // A collapsed container makes the drag math divide by zero, and the quotient
    // reaches here as NaN or an infinity; the box falls back to its floor rather
    // than to a percent that no longer moves.
    expect(sanitizePercent(Number.NaN, 80)).toBe(0)
    expect(sanitizePercent(Number.POSITIVE_INFINITY, 80)).toBe(0)
    expect(sanitizePercent(Number.NEGATIVE_INFINITY, 80)).toBe(0)
  })

  it("respects a floor that keeps the grip on screen", () => {
    expect(sanitizePercent(1, 80, 6)).toBe(6)
    expect(sanitizePercent(40, 80, 6)).toBe(40)
  })

  it("stays usable when the box is taller than the player", () => {
    expect(sanitizePercent(10, -20, 0)).toBe(0)
  })
})
