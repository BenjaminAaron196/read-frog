/** The ajo (Reuters' video CDN) playlist id embedded in every video's HLS URL. */
const AJO_PLAYLIST_PATTERN = /v3\/playlist\/(\d+)\/master\.m3u8/

/**
 * Reuters publishes the video's HLS URL server-side in both `og:video:url` and
 * the Arc `Fusion.globalContent` payload, so the numeric ajo id can be read
 * before the JW player has mounted.
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
