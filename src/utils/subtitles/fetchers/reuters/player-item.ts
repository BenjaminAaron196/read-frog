import {
  JW_PLAYER_ITEM_REQUEST_TYPE,
  JW_PLAYER_ITEM_RESPONSE_TYPE,
  JW_PLAYER_ITEM_TIMEOUT_MS,
} from "@/utils/constants/subtitles"
import { getRandomUUID } from "@/utils/crypto-polyfill"
import {
  AJO_PLAYLIST_PATTERN,
  getReutersPlayers,
  rememberReutersPlayerVideoId,
} from "@/utils/subtitles/video-id"

export interface JwPlayerItem {
  file: string | null
  id: string | null
  title: string | null
}

interface JwPlayerItemResponse {
  type?: string
  requestId?: string
  item?: JwPlayerItem | null
}

/**
 * Asks the page world for a player's current playlist item. Reuters resolves
 * the ajo video id into the player instance, which a content script cannot
 * read, and a listing page carries one instance per video.
 */
export function requestJwPlayerItem(
  playerId: string,
  playerIndex: number,
): Promise<JwPlayerItem | null> {
  const { promise, resolve } = Promise.withResolvers<JwPlayerItem | null>()
  const requestId = getRandomUUID()

  const handler = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== window) {
      return
    }

    const data = event.data as JwPlayerItemResponse | undefined
    if (data?.type !== JW_PLAYER_ITEM_RESPONSE_TYPE || data.requestId !== requestId) {
      return
    }

    window.removeEventListener("message", handler)
    resolve(data.item ?? null)
  }

  window.addEventListener("message", handler)
  window.postMessage(
    { type: JW_PLAYER_ITEM_REQUEST_TYPE, requestId, playerId, playerIndex },
    window.location.origin,
  )

  setTimeout(() => {
    // Without the MAIN-world listener (an older page, a frame we are not in)
    // the caller falls back to the id the page publishes itself.
    window.removeEventListener("message", handler)
    resolve(null)
  }, JW_PLAYER_ITEM_TIMEOUT_MS)

  return promise
}

/** The ajo video id behind a playlist item, and the overlay's memory of it. */
export async function resolveReutersPlayerVideoId(player: HTMLElement): Promise<string | null> {
  const index = getReutersPlayers().indexOf(player)
  const item = await requestJwPlayerItem(player.id, index >= 0 ? index : 0)
  const videoId = item?.file?.match(AJO_PLAYLIST_PATTERN)?.[1] ?? null
  if (videoId) {
    rememberReutersPlayerVideoId(player, videoId)
  }
  return videoId
}
