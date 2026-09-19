import type { SubtitlesFragment } from "../../types"
import type { SubtitlesFetcher } from "../types"
import { backgroundFetch } from "@/utils/content-script/background-fetch-client"
import { i18n } from "@/utils/i18n"
import { OverlaySubtitlesError } from "@/utils/subtitles/errors"
import { getActiveReutersPlayer, getReutersVideoId } from "@/utils/subtitles/video-id"
import { parseVttCues } from "../parsers/vtt"
import { resolveReutersPlayerVideoId } from "./player-item"

/**
 * ajo, Reuters' video CDN, publishes the caption rendition declared by the HLS
 * master playlist as a plain WebVTT file per video id. `en_US` is the only
 * track it serves and the host sends no CORS headers, so the request goes
 * through the background worker rather than the page context.
 */
const CAPTION_ENDPOINT = "https://ajo.prod.reuters.tv/v3/caption/en_US"
const SOURCE_LANGUAGE = "en"

export class ReutersSubtitlesFetcher implements SubtitlesFetcher {
  private subtitles: SubtitlesFragment[] = []
  private cachedVideoId: string | null = null

  async fetch(): Promise<SubtitlesFragment[]> {
    const videoId = await this.resolveCaptionVideoId()
    if (!videoId) {
      throw new OverlaySubtitlesError(i18n.t("subtitles.errors.videoNotFound"))
    }

    const cues = await this.loadCues(videoId)
    if (!cues) {
      throw new OverlaySubtitlesError(i18n.t("subtitles.errors.noSubtitlesFound"))
    }

    return cues
  }

  getSourceLanguage(): string {
    return SOURCE_LANGUAGE
  }

  async hasAvailableSubtitles(): Promise<boolean> {
    const videoId = await this.resolveCaptionVideoId()
    if (!videoId) {
      return false
    }
    return (await this.loadCues(videoId)) !== null
  }

  async shouldUseSameTrack(): Promise<boolean> {
    if (this.cachedVideoId === null || this.subtitles.length === 0) {
      return false
    }
    return this.cachedVideoId === (await this.resolveCaptionVideoId())
  }

  cleanup(): void {
    this.subtitles = []
    this.cachedVideoId = null
  }

  /**
   * Reuters' listings hold several players, so the caption id has to come from
   * the player the overlay follows rather than from the page. The page-level id
   * (article pages, or when the player cannot be asked) stays as the fallback.
   */
  private async resolveCaptionVideoId(): Promise<string | null> {
    const player = getActiveReutersPlayer()
    if (player) {
      const fromPlayer = await resolveReutersPlayerVideoId(player)
      if (fromPlayer) {
        return fromPlayer
      }
    }

    return getReutersVideoId()
  }

  // Reuters ships captions for most - not all - videos, and some carry an empty
  // WebVTT header; both answer `null` so the caller reports "no subtitles"
  // instead of rendering an empty track.
  private async loadCues(videoId: string): Promise<SubtitlesFragment[] | null> {
    if (this.cachedVideoId === videoId && this.subtitles.length > 0) {
      return this.subtitles
    }

    let cues: SubtitlesFragment[]
    try {
      const response = await backgroundFetch(
        `${CAPTION_ENDPOINT}/${videoId}`,
        { method: "GET" },
        { credentials: "omit" },
      )
      if (!response.ok) {
        return null
      }
      cues = parseVttCues(await response.text())
    } catch {
      return null
    }

    if (cues.length === 0) {
      return null
    }

    this.subtitles = cues
    this.cachedVideoId = videoId
    return cues
  }
}
