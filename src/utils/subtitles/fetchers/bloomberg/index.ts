import type { SubtitlesFragment } from "../../types"
import type { SubtitlesFetcher } from "../types"
import { i18n } from "@/utils/i18n"
import { OverlaySubtitlesError } from "@/utils/subtitles/errors"
import { getBloombergAssetId } from "@/utils/subtitles/video-id"
import { parseTtmlCues } from "../parsers/ttml"

/**
 * Bloomberg's playback manifest. Public, no credentials, and the only place
 * that names the caption asset: `captions` is a TTML (`.dfxp`) file on the same
 * CDN that serves the video, with `CORS: *`.
 */
const MANIFEST_ENDPOINT = "https://www.bloomberg.com/media-manifest/embed"
const MANIFEST_VARIANT_QUERY = "variant=WEB&streamType=WIFI"
const REQUEST_TIMEOUT_MS = 10_000

interface BloombergManifest {
  captions?: string | null
  transcriptLanguage?: string | null
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    if (!response.ok) {
      return null
    }
    return await response.text()
  } catch {
    return null
  }
}

export class BloombergSubtitlesFetcher implements SubtitlesFetcher {
  private subtitles: SubtitlesFragment[] = []
  private sourceLanguage = ""
  private cachedAssetId: string | null = null
  private manifestCache: { assetId: string; manifest: BloombergManifest } | null = null

  async fetch(): Promise<SubtitlesFragment[]> {
    const assetId = getBloombergAssetId()
    if (!assetId) {
      throw new OverlaySubtitlesError(i18n.t("subtitles.errors.videoNotFound"))
    }
    if (this.cachedAssetId === assetId && this.subtitles.length > 0) {
      return this.subtitles
    }

    const manifest = await this.loadManifest(assetId)
    const captionsUrl = manifest?.captions
    if (!captionsUrl) {
      throw new OverlaySubtitlesError(i18n.t("subtitles.errors.noSubtitlesFound"))
    }

    const document = await fetchText(captionsUrl)
    if (document === null) {
      throw new OverlaySubtitlesError(i18n.t("subtitles.errors.networkError"))
    }

    const cues = parseTtmlCues(document)
    if (cues.length === 0) {
      throw new OverlaySubtitlesError(i18n.t("subtitles.errors.noSubtitlesFound"))
    }

    this.subtitles = cues
    this.sourceLanguage = manifest?.transcriptLanguage ?? ""
    this.cachedAssetId = assetId

    return cues
  }

  getSourceLanguage(): string {
    return this.sourceLanguage
  }

  async hasAvailableSubtitles(): Promise<boolean> {
    const assetId = getBloombergAssetId()
    if (!assetId) {
      return false
    }
    if (this.cachedAssetId === assetId && this.subtitles.length > 0) {
      return true
    }

    const manifest = await this.loadManifest(assetId)
    return Boolean(manifest?.captions)
  }

  async shouldUseSameTrack(): Promise<boolean> {
    if (this.cachedAssetId === null || this.subtitles.length === 0) {
      return false
    }
    return this.cachedAssetId === getBloombergAssetId()
  }

  cleanup(): void {
    this.subtitles = []
    this.sourceLanguage = ""
    this.cachedAssetId = null
    this.manifestCache = null
  }

  // A missing manifest is left uncached so a transient failure does not
  // disable subtitles for the rest of the session.
  private async loadManifest(assetId: string): Promise<BloombergManifest | null> {
    if (this.manifestCache?.assetId === assetId) {
      return this.manifestCache.manifest
    }

    const query = `?id=${encodeURIComponent(assetId)}&${MANIFEST_VARIANT_QUERY}`
    const body = await fetchText(`${MANIFEST_ENDPOINT}${query}`)
    if (body === null) {
      return null
    }

    let manifest: BloombergManifest
    try {
      manifest = JSON.parse(body) as BloombergManifest
    } catch {
      return null
    }

    this.manifestCache = { assetId, manifest }
    return manifest
  }
}
