import type { PlatformConfig } from "@/entrypoints/subtitles.content/platforms"
import { BloombergSubtitlesFetcher } from "@/utils/subtitles/fetchers"
import { UniversalVideoAdapter } from "../../universal-adapter"

export function createBloombergSubtitlesAdapter(config: PlatformConfig) {
  return new UniversalVideoAdapter({
    config,
    fetchers: {
      native: () => new BloombergSubtitlesFetcher(),
    },
  })
}
