import type { ContentScriptContext } from "#imports"
import { initBloombergSubtitles } from "./init-bloomberg-subtitles"
import { initReutersSubtitles } from "./init-reuters-subtitles"
import { initYoutubeSubtitles } from "./init-youtube-subtitles"

let hasBootstrappedSubtitlesRuntime = false

const BLOOMBERG_HOST_PATTERN = /(?:^|\.)bloomberg\.com$/i
const REUTERS_HOST_PATTERN = /(?:^|\.)reuters\.com$/i

export function bootstrapSubtitlesRuntime(ctx: ContentScriptContext) {
  if (hasBootstrappedSubtitlesRuntime) {
    return
  }

  hasBootstrappedSubtitlesRuntime = true

  if (BLOOMBERG_HOST_PATTERN.test(window.location.hostname)) {
    initBloombergSubtitles(ctx)
    return
  }

  if (REUTERS_HOST_PATTERN.test(window.location.hostname)) {
    initReutersSubtitles(ctx)
    return
  }

  initYoutubeSubtitles(ctx)
}
