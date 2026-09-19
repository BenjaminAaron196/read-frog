import type { PlatformConfig } from "@/entrypoints/subtitles.content/platforms"
import { DEFAULT_CONTROLS_HEIGHT } from "@/utils/constants/subtitles"
import {
  REUTERS_ACTIVE_PLAYER_ATTRIBUTE,
  getActiveReutersVideoId,
} from "@/utils/subtitles/video-id"

const ACTIVE_PLAYER_SELECTOR = `[${REUTERS_ACTIVE_PLAYER_ATTRIBUTE}]`

/**
 * Reuters plays video through JW Player 8 (`renderCaptionsNatively: false`, so
 * captions render into its own `.jw-captions` layer) and resolves the ajo video
 * id per player over the page bridge. The selectors target the player the
 * overlay follows - a listing page carries one per video - and the button
 * mounts into `.jw-button-container`, the row that holds the player icons,
 * because `.jw-controlbar` lays that row out on its own line.
 */
export function getReutersConfig(): PlatformConfig {
  return {
    selectors: {
      video: `${ACTIVE_PLAYER_SELECTOR} video.jw-video`,
      playerContainer: ACTIVE_PLAYER_SELECTOR,
      controlsBar: `${ACTIVE_PLAYER_SELECTOR} .jw-button-container`,
      nativeSubtitles: `${ACTIVE_PLAYER_SELECTOR} .jw-captions`,
    },
    events: {},
    controls: {
      insertPosition: "end",
      // The settings panel and the overlay sit above the button row, so they
      // need its height while it is on screen; JW Player marks the player root
      // while the bar is faded out.
      measureHeight: (container) =>
        container.querySelector(".jw-button-container")?.getBoundingClientRect().height ??
        DEFAULT_CONTROLS_HEIGHT,
      checkVisibility: (container) => !container.classList.contains("jw-flag-user-inactive"),
    },
    supportsSidebar: true,
    getVideoId: getActiveReutersVideoId,
  }
}
