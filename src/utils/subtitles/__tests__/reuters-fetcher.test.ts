// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ReutersSubtitlesFetcher } from "../fetchers/reuters"
import { setActiveReutersPlayer } from "../video-id"

const mocks = vi.hoisted(() => ({
  backgroundFetch: vi.fn<(...args: unknown[]) => Promise<Response>>(),
  resolvePlayerVideoId: vi.fn<(player: HTMLElement) => Promise<string | null>>(),
}))

vi.mock("@/utils/content-script/background-fetch-client", () => ({
  backgroundFetch: (...args: unknown[]) => mocks.backgroundFetch(...args),
}))

// The player bridge needs the MAIN-world listener, which jsdom has no way to
// host; the fetcher's own fallback path is what these tests exercise.
vi.mock("../fetchers/reuters/player-item", () => ({
  resolveReutersPlayerVideoId: (player: HTMLElement) => mocks.resolvePlayerVideoId(player),
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

function renderPlayer(id: string) {
  const player = document.createElement("div")
  player.className = "jwplayer"
  player.id = id
  player.innerHTML = `<video class="jw-video"></video>`
  document.body.append(player)
  return player
}

describe("reutersSubtitlesFetcher", () => {
  beforeEach(() => {
    mocks.backgroundFetch.mockReset()
    mocks.resolvePlayerVideoId.mockReset()
    mocks.resolvePlayerVideoId.mockResolvedValue(null)
  })

  afterEach(() => {
    document.head.innerHTML = ""
    document.body.innerHTML = ""
  })

  it("loads the caption file for the ajo id in the page metadata", async () => {
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8`)
    mocks.backgroundFetch.mockResolvedValue(vttResponse(VTT))
    const fetcher = new ReutersSubtitlesFetcher()

    await expect(fetcher.fetch()).resolves.toEqual([
      { text: "A German court has sentenced a 61-year old man", start: 1480, end: 5583 },
      { text: "for repeatedly drugging his wife", start: 5584, end: 11_184 },
    ])
    expect(mocks.backgroundFetch.mock.calls[0]?.[0]).toBe(
      `https://ajo.prod.reuters.tv/v3/caption/en_US/${VIDEO_ID}`,
    )
    expect(fetcher.getSourceLanguage()).toBe("en")
    await expect(fetcher.shouldUseSameTrack()).resolves.toBe(true)
  })

  it("prefers the id of the player the overlay follows", async () => {
    // The page-level id belongs to the listing's lead video; the followed
    // player is showing something else.
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/111111/master.m3u8`)
    const player = renderPlayer("player-3")
    setActiveReutersPlayer(player)
    mocks.resolvePlayerVideoId.mockResolvedValue("788331")
    mocks.backgroundFetch.mockResolvedValue(vttResponse(VTT))
    const fetcher = new ReutersSubtitlesFetcher()

    await fetcher.fetch()

    expect(mocks.resolvePlayerVideoId).toHaveBeenCalledWith(player)
    expect(mocks.backgroundFetch.mock.calls[0]?.[0]).toBe(
      "https://ajo.prod.reuters.tv/v3/caption/en_US/788331",
    )
  })

  it("falls back to the page metadata when the player cannot be asked", async () => {
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8`)
    setActiveReutersPlayer(renderPlayer("player-2"))
    mocks.resolvePlayerVideoId.mockResolvedValue(null)
    mocks.backgroundFetch.mockResolvedValue(vttResponse(VTT))
    const fetcher = new ReutersSubtitlesFetcher()

    await fetcher.fetch()

    expect(mocks.backgroundFetch.mock.calls[0]?.[0]).toBe(
      `https://ajo.prod.reuters.tv/v3/caption/en_US/${VIDEO_ID}`,
    )
  })

  it("falls back to the Fusion payload when the page has no og:video meta", async () => {
    document.head.innerHTML = "<title>Reuters</title>"
    document.body.innerHTML = `<script id="fusion-metadata">window.Fusion.globalContent={"source":{"hls":"https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8"}}</script>`
    mocks.backgroundFetch.mockResolvedValue(vttResponse(VTT))
    const fetcher = new ReutersSubtitlesFetcher()

    await expect(fetcher.hasAvailableSubtitles()).resolves.toBe(true)
    expect(mocks.backgroundFetch).toHaveBeenCalledTimes(1)
  })

  it("shares one caption request between the availability probe and the fetch", async () => {
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8`)
    mocks.backgroundFetch.mockResolvedValue(vttResponse(VTT))
    const fetcher = new ReutersSubtitlesFetcher()

    await fetcher.hasAvailableSubtitles()
    const cues = await fetcher.fetch()

    expect(cues).toHaveLength(2)
    expect(mocks.backgroundFetch).toHaveBeenCalledTimes(1)
  })

  it("reports no subtitles for a caption file without cues", async () => {
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8`)
    mocks.backgroundFetch.mockResolvedValue(
      vttResponse("WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:186000,LOCAL:00:00:00.000\n"),
    )
    const fetcher = new ReutersSubtitlesFetcher()

    await expect(fetcher.hasAvailableSubtitles()).resolves.toBe(false)
    await expect(fetcher.fetch()).rejects.toThrow("subtitles.errors.noSubtitlesFound")
  })

  it("reports no subtitles when the caption request fails", async () => {
    renderVideoUrl(`https://ajo.prod.reuters.tv/v3/playlist/${VIDEO_ID}/master.m3u8`)
    mocks.backgroundFetch.mockRejectedValue(new Error("network down"))
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
