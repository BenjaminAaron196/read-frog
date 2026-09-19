import type { PlatformConfig } from "@/entrypoints/subtitles.content/platforms"
import { DEFAULT_CONTROLS_HEIGHT } from "@/utils/constants/subtitles"
import { BLOOMBERG_PLAYER_SELECTOR, getBloombergAssetId } from "@/utils/subtitles/video-id"

/**
 * Bloomberg's Skylight player is Video.js 8: the root carries the asset id and
 * hosts the native caption layer, and the control bar accepts the translate
 * button like any other player chrome.
 */
export function getBloombergConfig(): PlatformConfig {
  return {
    selectors: {
      video: "video.vjs-tech",
      playerContainer: BLOOMBERG_PLAYER_SELECTOR,
      controlsBar: ".vjs-control-bar",
      nativeSubtitles: ".vjs-text-track-display",
    },
    events: {},
    controls: {
      insertPosition: "end",
      // The settings panel and the overlay sit above the control bar, so they
      // need its height while it is on screen; Video.js marks the player root
      // while the bar is faded out.
      measureHeight: (container) =>
        container.querySelector(".vjs-control-bar")?.getBoundingClientRect().height ??
        DEFAULT_CONTROLS_HEIGHT,
      checkVisibility: (container) => !container.classList.contains("vjs-user-inactive"),
    },
    supportsSidebar: true,
    getVideoId: getBloombergAssetId,
  }
}
