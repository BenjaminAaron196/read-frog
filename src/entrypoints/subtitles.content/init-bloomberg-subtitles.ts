import type { ContentScriptContext } from "#imports"
import { initSiteSubtitles } from "./init-site-subtitles"
import { createBloombergSubtitlesAdapter } from "./platforms/bloomberg"
import { getBloombergConfig } from "./platforms/bloomberg/config"

export function initBloombergSubtitles(ctx: ContentScriptContext) {
  const config = getBloombergConfig()
  const adapter = createBloombergSubtitlesAdapter(config)

  void initSiteSubtitles({ ctx, adapter, config })
}
