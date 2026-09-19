import type { ContentScriptContext } from "#imports"
import { TRANSLATE_BUTTON_CONTAINER_ID } from "@/utils/constants/subtitles"
import { waitForElement } from "@/utils/dom/wait-for-element"
import { removeReactShadowHost } from "@/utils/react-shadow-host/create-shadow-host"
import { resolveReutersPlayerVideoId } from "@/utils/subtitles/fetchers/reuters/player-item"
import {
  REUTERS_PLAYER_SELECTOR,
  getActiveReutersPlayer,
  getActiveReutersVideoId,
  setActiveReutersPlayer,
  watchReutersPlayingVideo,
} from "@/utils/subtitles/video-id"
import { initSiteSubtitles } from "./init-site-subtitles"
import { createReutersSubtitlesAdapter } from "./platforms/reuters"
import { getReutersConfig } from "./platforms/reuters/config"
import { mountSubtitlesUI } from "./renderer/mount-subtitles-ui"

/** A player the overlay left behind keeps its button; drop it so only the
 *  followed player shows one. */
function removeStaleTranslateButtons(activePlayer: HTMLElement): void {
  for (const button of document.querySelectorAll(`#${TRANSLATE_BUTTON_CONTAINER_ID}`)) {
    if (!activePlayer.contains(button)) {
      removeReactShadowHost(button as HTMLElement)
    }
  }
}

/**
 * Reuters listings keep one JW player per video and mount the rest as the
 * reader scrolls, so the overlay follows whichever video starts playing instead
 * of staying on the first player it found. Each player carries its own ajo
 * video id, resolved over the page bridge before the session switches.
 */
export function initReutersSubtitles(ctx: ContentScriptContext): void {
  const config = getReutersConfig()
  const adapter = createReutersSubtitlesAdapter(config)
  let attached = false

  const attach = async (player: HTMLElement) => {
    const wasActive = player === getActiveReutersPlayer()
    const previousVideoId = getActiveReutersVideoId()

    setActiveReutersPlayer(player)
    await resolveReutersPlayerVideoId(player)

    // Pausing and resuming the same video fires `play` again; only a different
    // player or a different video inside it is worth restarting for.
    if (attached && wasActive && getActiveReutersVideoId() === previousVideoId) {
      return
    }

    removeStaleTranslateButtons(player)

    if (!attached) {
      attached = true
      await initSiteSubtitles({ ctx, adapter, config })
      return
    }

    await mountSubtitlesUI({ adapter, config })
    adapter.notifyNavigation()
  }

  ctx.onInvalidated(
    watchReutersPlayingVideo((player) => {
      void attach(player)
    }),
  )

  // Attach to the lead video before anyone plays it, so the button is already
  // there when the reader reaches for it.
  void (async () => {
    const player = (await waitForElement(REUTERS_PLAYER_SELECTOR)) as HTMLElement | null
    if (player) {
      await attach(player)
    }
  })()
}
