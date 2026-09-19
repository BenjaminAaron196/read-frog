// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { BloombergSubtitlesFetcher } from "../fetchers/bloomberg"

const ASSET_ID = "34d4d9f9-c864-42d3-9e4a-f18f97a44ab1"
const CAPTIONS_URL = "https://bbgvod.example/vod/captions/20260916015329_en_User.dfxp"

const DFXP = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns="http://www.w3.org/ns/ttml"><body><div>
  <p begin="00:00:00.360" end="00:00:03.680">The yen has been at<br />levels not seen in four</p>
  <p begin="00:00:03.680" end="00:00:04.800">decades this year.</p>
</div></body></tt>`

const PLAYER_ID = `skylight-vod-${ASSET_ID}-dai`

function renderPlayer() {
  document.body.innerHTML = `<div class="video-js vjs-fluid" id="${PLAYER_ID}"><video class="vjs-tech" id="${PLAYER_ID}_html5_api"></video></div>`
}

function manifestResponse(captions: string | null) {
  return {
    ok: true,
    text: async () => JSON.stringify({ captions, transcriptLanguage: "en" }),
  } as Response
}

function dfxpResponse(body: string) {
  return { ok: true, text: async () => body } as Response
}

describe("bloombergSubtitlesFetcher", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  it("reads the asset id off the player element and loads the manifest's caption file", async () => {
    renderPlayer()
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(manifestResponse(CAPTIONS_URL))
      .mockResolvedValueOnce(dfxpResponse(DFXP))
    const fetcher = new BloombergSubtitlesFetcher()

    await expect(fetcher.fetch()).resolves.toEqual([
      { text: "The yen has been at levels not seen in four", start: 360, end: 3680 },
      { text: "decades this year.", start: 3680, end: 4800 },
    ])
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://www.bloomberg.com/media-manifest/embed?id=${ASSET_ID}&variant=WEB&streamType=WIFI`,
    )
    expect(fetchMock.mock.calls[1]?.[0]).toBe(CAPTIONS_URL)
    expect(fetcher.getSourceLanguage()).toBe("en")
    await expect(fetcher.shouldUseSameTrack()).resolves.toBe(true)
  })

  it("answers repeated fetches from the cache", async () => {
    renderPlayer()
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(manifestResponse(CAPTIONS_URL))
      .mockResolvedValueOnce(dfxpResponse(DFXP))
    const fetcher = new BloombergSubtitlesFetcher()

    const first = await fetcher.fetch()
    const second = await fetcher.fetch()

    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("reports no subtitles when the manifest has no caption track", async () => {
    renderPlayer()
    vi.spyOn(globalThis, "fetch").mockResolvedValue(manifestResponse(null))
    const fetcher = new BloombergSubtitlesFetcher()

    await expect(fetcher.hasAvailableSubtitles()).resolves.toBe(false)
    await expect(fetcher.fetch()).rejects.toThrow("subtitles.errors.noSubtitlesFound")
  })

  it("reports no subtitles when the caption file is missing", async () => {
    renderPlayer()
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(manifestResponse(CAPTIONS_URL))
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
    const fetcher = new BloombergSubtitlesFetcher()

    await expect(fetcher.fetch()).rejects.toThrow("subtitles.errors.networkError")
  })

  it("throws videoNotFound when the page holds no Bloomberg player", async () => {
    document.body.innerHTML = "<main></main>"
    const fetcher = new BloombergSubtitlesFetcher()

    await expect(fetcher.hasAvailableSubtitles()).resolves.toBe(false)
    await expect(fetcher.fetch()).rejects.toThrow("subtitles.errors.videoNotFound")
  })

  it("stops reusing the cache once the player shows a different asset", async () => {
    renderPlayer()
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(manifestResponse(CAPTIONS_URL))
      .mockResolvedValueOnce(dfxpResponse(DFXP))
    const fetcher = new BloombergSubtitlesFetcher()
    await fetcher.fetch()

    document.body.innerHTML = `<div class="video-js" id="skylight-vod-44fc6670-b35f-4a2c-96db-f424873a3eb1-dai"></div>`

    await expect(fetcher.shouldUseSameTrack()).resolves.toBe(false)
  })
})
