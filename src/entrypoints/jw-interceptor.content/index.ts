import { defineContentScript } from "#imports"
import {
  JW_PLAYER_ITEM_REQUEST_TYPE,
  JW_PLAYER_ITEM_RESPONSE_TYPE,
} from "@/utils/constants/subtitles"

interface JwPlaylistItem {
  file?: string | null
  id?: string | null
  title?: string | null
}

interface JwPlayerInstance {
  getPlaylistItem?: () => JwPlaylistItem
}

type JwPlayerFactory = (target?: string | HTMLElement) => JwPlayerInstance | undefined

declare global {
  interface Window {
    jwplayer?: JwPlayerFactory
  }
}

/**
 * Reuters' player keeps the ajo video id inside its own playlist item, which
 * only exists in the page world. The content script cannot reach it, so this
 * MAIN-world listener answers with the item of a given player.
 */
function readPlaylistItem(playerId: string, playerIndex: number): JwPlaylistItem | null {
  const factory = window.jwplayer
  if (typeof factory !== "function") {
    return null
  }

  try {
    const target = playerId || document.querySelectorAll<HTMLElement>(".jwplayer")[playerIndex]
    if (!target) {
      return null
    }

    const item = factory(target)?.getPlaylistItem?.()
    if (!item) {
      return null
    }

    return { file: item.file ?? null, id: item.id ?? null, title: item.title ?? null }
  } catch {
    // A player that is being torn down throws on lookup; the caller treats a
    // missing item as "no captions here".
    return null
  }
}

export default defineContentScript({
  matches: ["*://*.reuters.com/*"],
  allFrames: true,
  world: "MAIN",
  runAt: "document_idle",
  main() {
    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin || event.source !== window) {
        return
      }

      const data = event.data as
        | { type?: string; requestId?: string; playerId?: string; playerIndex?: number }
        | undefined
      if (data?.type !== JW_PLAYER_ITEM_REQUEST_TYPE || typeof data.requestId !== "string") {
        return
      }

      window.postMessage(
        {
          type: JW_PLAYER_ITEM_RESPONSE_TYPE,
          requestId: data.requestId,
          item: readPlaylistItem(
            typeof data.playerId === "string" ? data.playerId : "",
            typeof data.playerIndex === "number" ? data.playerIndex : 0,
          ),
        },
        window.location.origin,
      )
    })
  },
})
