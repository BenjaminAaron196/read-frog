// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { DEFAULT_CONTROLS_HEIGHT } from "@/utils/constants/subtitles"
import { getReutersConfig } from "../platforms/reuters/config"

/**
 * The settings panel and the subtitle overlay anchor above the button row, so
 * a missing controls config silently drops them onto the player's bottom edge -
 * exactly where the translate button lives.
 */
function renderPlayer() {
  document.body.innerHTML = `
    <div class="jwplayer jw-reset" id="player-1">
      <video class="jw-video jw-reset"></video>
      <div class="jw-controlbar"><div class="jw-button-container"></div></div>
    </div>`
  const buttonContainer = document.querySelector<HTMLElement>(".jw-button-container")!
  buttonContainer.getBoundingClientRect = () =>
    ({
      height: 44,
      width: 800,
      x: 0,
      y: 545,
      top: 545,
      bottom: 589,
      left: 0,
      right: 800,
    }) as DOMRect
}

describe("reuters platform config", () => {
  it("mounts the translate button inside the player's button row", () => {
    renderPlayer()
    const { controlsBar, video, playerContainer } = getReutersConfig().selectors

    expect(document.querySelector(controlsBar!)?.className).toContain("jw-button-container")
    expect(document.querySelector(video)?.closest(playerContainer)?.id).toBe("player-1")
  })

  it("reports the control row geometry the settings panel anchors to", () => {
    renderPlayer()
    const controls = getReutersConfig().controls
    const player = document.querySelector<HTMLElement>(".jwplayer")!

    expect(controls?.measureHeight?.(player)).toBe(44)
    expect(controls?.checkVisibility?.(player)).toBe(true)

    // JW Player marks the root while the bar is faded out.
    player.classList.add("jw-flag-user-inactive")
    expect(controls?.checkVisibility?.(player)).toBe(false)
  })

  it("falls back to the default controls height without a button row", () => {
    document.body.innerHTML = `<div class="jwplayer"></div>`
    expect(getReutersConfig().controls?.measureHeight?.(document.body)).toBe(
      DEFAULT_CONTROLS_HEIGHT,
    )
  })
})
