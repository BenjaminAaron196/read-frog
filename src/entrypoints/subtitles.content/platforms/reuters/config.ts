import type { PlatformConfig } from "@/entrypoints/subtitles.content/platforms"
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
    controls: { insertPosition: "end" },
    supportsSidebar: true,
    getVideoId: getReutersVideoId,
  }
}
