import type { ContentScriptContext } from "#imports"
import type { PlatformConfig } from "./platforms"
import type { UniversalVideoAdapter } from "./universal-adapter"
import debounce from "debounce"
import { waitForElement } from "@/utils/dom/wait-for-element"
import { bindSubtitlesToggleShortcut } from "./bind-subtitles-toggle-shortcut"
import { mountSubtitlesSidebar } from "./renderer/mount-subtitles-sidebar"
import { mountSubtitlesUI } from "./renderer/mount-subtitles-ui"

const PLAYER_CHANGE_DEBOUNCE_MS = 300

interface InitSiteSubtitlesOptions {
  ctx: ContentScriptContext
  adapter: UniversalVideoAdapter
  config: PlatformConfig
}

/**
 * Boots the subtitles runtime on a host whose video is a plain in-page
 * `<video>` behind the site's own player chrome (Bloomberg's Video.js player,
 * Reuters' JW Player). The player is awaited before `initialize()` so the video
 * id - read from the player element on one site and from the page metadata on
 * the other - is published before the sidebar keys its queries on it. Both
 * sites route between videos client-side, so a swap to a different video tears
 * the overlay down and re-mounts it into the new player element.
 */
export async function initSiteSubtitles({
  ctx,
  adapter,
  config,
}: InitSiteSubtitlesOptions): Promise<void> {
  let currentVideoId = config.getVideoId?.() ?? null

  const observer = new MutationObserver(
    debounce(() => {
      const nextVideoId = config.getVideoId?.() ?? null
      if (nextVideoId === null || nextVideoId === currentVideoId) {
        return
      }

      currentVideoId = nextVideoId
      void mountSubtitlesUI({ adapter, config })
      adapter.notifyNavigation()
    }, PLAYER_CHANGE_DEBOUNCE_MS),
  )
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["id"],
    childList: true,
    subtree: true,
  })
  ctx.onInvalidated(() => observer.disconnect())

  if (!(await waitForElement(config.selectors.playerContainer))) {
    observer.disconnect()
    return
  }

  await mountSubtitlesUI({ adapter, config })
  mountSubtitlesSidebar(adapter)
  ctx.onInvalidated(await bindSubtitlesToggleShortcut(adapter))

  await adapter.initialize()
}
