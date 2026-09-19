import type { PlatformConfig } from "@/entrypoints/subtitles.content/platforms"
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
    controls: { insertPosition: "end" },
    supportsSidebar: true,
    getVideoId: getBloombergAssetId,
  }
}
