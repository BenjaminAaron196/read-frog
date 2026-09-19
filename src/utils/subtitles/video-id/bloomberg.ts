/**
 * The Video.js root element, which is the element the subtitles overlay must be
 * appended to. The tech element (`<video>`) carries the same id plus an
 * `_html5_api` suffix, so the `video-js` class is load-bearing: matching on the
 * id prefix alone can select the `<video>` itself, and a replaced element never
 * renders its children - the overlay and its settings panel silently disappear.
 */
export const BLOOMBERG_PLAYER_SELECTOR =
  'div.video-js[id^="skylight-vod-"], div.video-js[id^="skylight-live-"]'

const PLAYER_ID_PREFIX_PATTERN = /^skylight-(?:vod|live)-/
const PLAYER_ID_TECH_SUFFIX_PATTERN = /_html5_api$/
const PLAYER_ID_DAI_SUFFIX_PATTERN = /-dai$/

/**
 * Bloomberg names its Skylight player root `skylight-vod-<assetId>-dai`
 * (`skylight-live-<channel>-dai` on the live channels), which makes the asset
 * id the one stable video identity on the page - the media manifest and the
 * caption CDN path are both keyed by it.
 */
export function getBloombergAssetId(): string | null {
  const player = document.querySelector<HTMLElement>(BLOOMBERG_PLAYER_SELECTOR)
  if (!player) {
    return null
  }

  const assetId = player.id
    .replace(PLAYER_ID_PREFIX_PATTERN, "")
    .replace(PLAYER_ID_TECH_SUFFIX_PATTERN, "")
    .replace(PLAYER_ID_DAI_SUFFIX_PATTERN, "")

  return assetId || null
}
