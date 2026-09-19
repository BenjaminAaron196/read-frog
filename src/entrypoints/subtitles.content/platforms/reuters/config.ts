import type { PlatformConfig } from "@/entrypoints/subtitles.content/platforms"
import { DEFAULT_CONTROLS_HEIGHT } from "@/utils/constants/subtitles"
import { getReutersVideoId } from "@/utils/subtitles/video-id"

/**
 * Reuters plays video through JW Player 8 (`renderCaptionsNatively: false`, so
 * captions render into its own `.jw-captions` layer) and reads the numeric ajo
 * video id from the page metadata rather than the player element. The button
 * mounts into `.jw-button-container` - the row that holds the player icons -
 * because `.jw-controlbar` lays that row out on its own line.
 */
export function getReutersConfig(): PlatformConfig {
  return {
    selectors: {
      video: "video.jw-video",
      playerContainer: ".jwplayer",
      controlsBar: ".jw-controlbar .jw-button-container",
      nativeSubtitles: ".jw-captions",
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
    getVideoId: getReutersVideoId,
  }
}
