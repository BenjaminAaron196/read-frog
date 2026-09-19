// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { getBloombergAssetId } from "@/utils/subtitles/video-id"
import { getBloombergConfig } from "../platforms/bloomberg/config"

const ASSET_ID = "34d4d9f9-c864-42d3-9e4a-f18f97a44ab1"

const PLAYER_ID = `skylight-vod-${ASSET_ID}-dai`

/**
 * The tech element is nested inside the root and shares its id prefix, which is
 * what makes the player-container selector ambiguous if it only matches on the
 * prefix: an overlay appended to the `<video>` never renders.
 */
function renderPlayer() {
  document.body.innerHTML = `
    <div class="video-js vjs-fluid" id="${PLAYER_ID}">
      <video class="vjs-tech" id="${PLAYER_ID}_html5_api"></video>
      <div class="vjs-control-bar"></div>
    </div>`
}

describe("bloomberg platform config", () => {
  it("selects the Video.js root, never the tech element", () => {
    renderPlayer()
    const { playerContainer } = getBloombergConfig().selectors

    const container = document.querySelector(playerContainer)
    expect(container?.tagName).toBe("DIV")
    expect(container?.id).toBe(PLAYER_ID)
  })

  it("keeps the video element inside the player container", () => {
    renderPlayer()
    const { playerContainer, video } = getBloombergConfig().selectors

    const videoElement = document.querySelector(video)
    expect(videoElement?.tagName).toBe("VIDEO")
    expect(videoElement?.closest(playerContainer)?.id).toBe(PLAYER_ID)
  })

  it("reads the asset id from the player root when the tech element matches too", () => {
    renderPlayer()
    expect(getBloombergAssetId()).toBe(ASSET_ID)
  })
})
