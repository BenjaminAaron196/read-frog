import type { PlatformConfig } from "@/entrypoints/subtitles.content/platforms"
import { ReutersSubtitlesFetcher } from "@/utils/subtitles/fetchers"
import { UniversalVideoAdapter } from "../../universal-adapter"

export function createReutersSubtitlesAdapter(config: PlatformConfig) {
  return new UniversalVideoAdapter({
    config,
    fetchers: {
      native: () => new ReutersSubtitlesFetcher(),
    },
  })
}
