import type { ContentScriptContext } from "#imports"
import { initSiteSubtitles } from "./init-site-subtitles"
import { createReutersSubtitlesAdapter } from "./platforms/reuters"
import { getReutersConfig } from "./platforms/reuters/config"

export function initReutersSubtitles(ctx: ContentScriptContext) {
  const config = getReutersConfig()
  const adapter = createReutersSubtitlesAdapter(config)

  void initSiteSubtitles({ ctx, adapter, config })
}
