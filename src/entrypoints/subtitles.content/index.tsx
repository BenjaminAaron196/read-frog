import "@/utils/zod-config"
import { defineContentScript } from "#imports"
import { getLocalConfig } from "@/utils/config/storage"
import { initI18n } from "@/utils/i18n"

declare global {
  interface Window {
    __READ_FROG_SUBTITLES_INJECTED__?: boolean
  }
}

export default defineContentScript({
  matches: [
    "*://*.youtube.com/*",
    "*://*.youtube-nocookie.com/*",
    "*://*.bloomberg.com/*",
    "*://*.reuters.com/*",
  ],
  // The live channels carry no caption track at all, so there is nothing for
  // the overlay to show or translate there.
  excludeMatches: ["*://*.bloomberg.com/live/*"],
  allFrames: true,
  cssInjectionMode: "manifest",
  async main(ctx) {
    if (window.__READ_FROG_SUBTITLES_INJECTED__) return
    window.__READ_FROG_SUBTITLES_INJECTED__ = true

    const config = await getLocalConfig()
    if (!config?.videoSubtitles?.enabled) {
      window.__READ_FROG_SUBTITLES_INJECTED__ = false
      return
    }

    await initI18n(config.uiLanguage)

    ctx.onInvalidated(() => {
      window.__READ_FROG_SUBTITLES_INJECTED__ = false
    })

    const { bootstrapSubtitlesRuntime } = await import("./runtime")
    bootstrapSubtitlesRuntime(ctx)
  },
})
