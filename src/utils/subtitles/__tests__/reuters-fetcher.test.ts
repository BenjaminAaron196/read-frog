// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReutersSubtitlesFetcher } from "../fetchers/reuters"

const backgroundFetch = vi.fn<(...args: unknown[]) => Promise<Response>>()

vi.mock("@/utils/content-script/background-fetch-client", () => ({
  backgroundFetch: (...args: unknown[]) => backgroundFetch(...args),
}))

const VIDEO_ID = "726321"

const VTT = `WEBVTT
X-TIMESTAMP-MAP=MPEGTS:186000,LOCAL:00:00:00.000

1
00:00:01.480 --> 00:00:05.583 line:-3
 A German court has sentenced a 61-year old man

2
00:00:05.584 --> 00:00:11.184 line:-3
for repeatedly drugging his wife
`

function vttResponse(body: string, ok = true) {
  return { ok, text: async () => body } as Response
}

function renderVideoUrl(url: string) {
  document.head.innerHTML = `<meta property="og:video:url" content="${url}" />`
}

describe("reutersSubtitlesFetcher", () => {
  beforeEach(() => {
    backgroundFetch.mockReset()
  })

  afterEach(() => {
    document.head.innerHTML = ""
    document.body.innerHTML = ""
  })

  it("loads the caption file for the ajo id in the page metadata", async () => {
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8`)
    backgroundFetch.mockResolvedValue(vttResponse(VTT))
    const fetcher = new ReutersSubtitlesFetcher()

    await expect(fetcher.fetch()).resolves.toEqual([
      { text: "A German court has sentenced a 61-year old man", start: 1480, end: 5583 },
      { text: "for repeatedly drugging his wife", start: 5584, end: 11_184 },
    ])
    expect(backgroundFetch.mock.calls[0]?.[0]).toBe(
      `https://ajo.prod.reuters.tv/v3/caption/en_US/${VIDEO_ID}`,
    )
    expect(fetcher.getSourceLanguage()).toBe("en")
    await expect(fetcher.shouldUseSameTrack()).resolves.toBe(true)
  })

  it("falls back to the Fusion payload when the page has no og:video meta", async () => {
    document.head.innerHTML = "<title>Reuters</title>"
    document.body.innerHTML = `<script id="fusion-metadata">window.Fusion.globalContent={"source":{"hls":"https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8"}}</script>`
    backgroundFetch.mockResolvedValue(vttResponse(VTT))
    const fetcher = new ReutersSubtitlesFetcher()

    await expect(fetcher.hasAvailableSubtitles()).resolves.toBe(true)
    expect(backgroundFetch).toHaveBeenCalledTimes(1)
  })

  it("shares one caption request between the availability probe and the fetch", async () => {
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8`)
    backgroundFetch.mockResolvedValue(vttResponse(VTT))
    const fetcher = new ReutersSubtitlesFetcher()

    await fetcher.hasAvailableSubtitles()
    const cues = await fetcher.fetch()

    expect(cues).toHaveLength(2)
    expect(backgroundFetch).toHaveBeenCalledTimes(1)
  })

  it("reports no subtitles for a caption file without cues", async () => {
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8`)
    backgroundFetch.mockResolvedValue(
      vttResponse("WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:186000,LOCAL:00:00:00.000\n"),
    )
    const fetcher = new ReutersSubtitlesFetcher()

    await expect(fetcher.hasAvailableSubtitles()).resolves.toBe(false)
    await expect(fetcher.fetch()).rejects.toThrow("subtitles.errors.noSubtitlesFound")
  })

  it("reports no subtitles when the caption request fails", async () => {
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8`)
    backgroundFetch.mockRejectedValue(new Error("network down"))
    const fetcher = new ReutersSubtitlesFetcher()

    await expect(fetcher.hasAvailableSubtitles()).resolves.toBe(false)
  })

  it("throws videoNotFound when the page names no video", async () => {
    document.head.innerHTML = "<title>Reuters</title>"
    const fetcher = new ReutersSubtitlesFetcher()

    await expect(fetcher.hasAvailableSubtitles()).resolves.toBe(false)
    await expect(fetcher.fetch()).rejects.toThrow("subtitles.errors.videoNotFound")
  })
})
