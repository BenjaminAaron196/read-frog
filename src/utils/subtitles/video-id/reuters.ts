/** The ajo (Reuters' video CDN) playlist id embedded in every video's HLS URL. */
export const AJO_PLAYLIST_PATTERN = /v3\/playlist\/(\d+)\/master\.m3u8/

/** Reuters' JW Player root element. */
export const REUTERS_PLAYER_SELECTOR = ".jwplayer"
/** Marks the player the overlay follows, so the platform selectors can find it. */
export const REUTERS_ACTIVE_PLAYER_ATTRIBUTE = "data-read-frog-reuters-player"

const ACTIVE_PLAYER_SELECTOR = `[${REUTERS_ACTIVE_PLAYER_ATTRIBUTE}]`

/**
 * Reuters publishes the video's HLS URL server-side in both `og:video:url` and
 * the Arc `Fusion.globalContent` payload. That only identifies the page's main
 * video - a listing page carries many - so it is the fallback for when the
 * player itself cannot be asked (see `getActiveReutersVideoId`).
 */
export function getReutersVideoId(): string | null {
  const ogVideoUrl = document.querySelector<HTMLMetaElement>(
    'meta[property="og:video:url"]',
  )?.content
  const fromMeta = ogVideoUrl?.match(AJO_PLAYLIST_PATTERN)?.[1]
  if (fromMeta) {
    return fromMeta
  }

  const fusionMetadata = document.getElementById("fusion-metadata")?.textContent
  return fusionMetadata?.match(AJO_PLAYLIST_PATTERN)?.[1] ?? null
}

export function getReutersPlayers(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(REUTERS_PLAYER_SELECTOR)]
}

export function getActiveReutersPlayer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(ACTIVE_PLAYER_SELECTOR)
}

export function getReutersPlayerFromVideo(video: HTMLVideoElement): HTMLElement | null {
  return video.closest<HTMLElement>(REUTERS_PLAYER_SELECTOR)
}

export function setActiveReutersPlayer(player: HTMLElement): void {
  for (const element of document.querySelectorAll(ACTIVE_PLAYER_SELECTOR)) {
    if (element !== player) {
      element.removeAttribute(REUTERS_ACTIVE_PLAYER_ATTRIBUTE)
    }
  }
  player.setAttribute(REUTERS_ACTIVE_PLAYER_ATTRIBUTE, "")
}

/**
 * Ids resolved from the player instance over the page bridge. They key the
 * sidebar and the summary cache, so they must follow the video actually being
 * watched on a page that holds several players.
 */
const resolvedVideoIds = new WeakMap<HTMLElement, string>()

export function rememberReutersPlayerVideoId(player: HTMLElement, videoId: string): void {
  resolvedVideoIds.set(player, videoId)
}

function hashRoute(value: string): string {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
  }
  return `reuters-${(hash >>> 0).toString(16)}`
}

/**
 * The video in the player the overlay follows: the ajo id once the bridge has
 * answered, and a stable route + player-index id until then - the id has to
 * exist before the first bridge round trip, because the overlay publishes it
 * while initializing.
 */
export function getActiveReutersVideoId(): string | null {
  const player = getActiveReutersPlayer()
  if (!player) {
    return getReutersVideoId()
  }

  const resolved = resolvedVideoIds.get(player)
  if (resolved) {
    return resolved
  }

  const index = getReutersPlayers().indexOf(player)
  const route = `${window.location.origin}${window.location.pathname}${window.location.search}`
  return hashRoute(`${route}#${index >= 0 ? index : 0}`)
}

/**
 * Any video that starts playing becomes the player the overlay follows. This
 * covers players the site mounts later - Reuters' listings add them as the
 * reader scrolls - because the listener sits on the document.
 */
export function watchReutersPlayingVideo(onPlay: (player: HTMLElement) => void): () => void {
  const handler = (event: Event) => {
    const target = event.target
    if (!(target instanceof HTMLVideoElement)) {
      return
    }

    const player = getReutersPlayerFromVideo(target)
    if (player) {
      onPlay(player)
    }
  }

  document.addEventListener("play", handler, true)
  return () => document.removeEventListener("play", handler, true)
}
