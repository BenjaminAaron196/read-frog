// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { parseTimestampToMs } from "../fetchers/parsers/timestamp"
import { parseTtmlCues } from "../fetchers/parsers/ttml"
import { parseVttCues } from "../fetchers/parsers/vtt"

// A Bloomberg media-manifest caption file: TTML with paragraph-level timings,
// `<br />` inside a two-line caption, and an entity.
const TTML_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<tt xmlns:tts="http://www.w3.org/ns/ttml#styling" xmlns="http://www.w3.org/ns/ttml">
  <head><layout><region xml:id="CaptionArea" /></layout></head>
  <body region="CaptionArea">
    <div>
      <p begin="00:00:00.360" end="00:00:03.680">The yen has been at<br />levels not seen in four</p>
      <p begin="00:00:03.680" end="00:00:04.800">decades this year.</p>
      <p begin="00:00:04.800" end="00:00:04.800">zero length, dropped</p>
      <p end="00:00:09.200" begin="00:00:07.560">for 164 yen &amp; one dollar</p>
      <p begin="00:00:09.200" end="00:00:13.480"><span tts:fontStyle="italic">In July</span> 2026</p>
    </div>
  </body>
</tt>`

// A Reuters ajo caption file: WebVTT with cue settings, a header block, and a
// multi-line payload.
const VTT_SAMPLE = `WEBVTT
X-TIMESTAMP-MAP=MPEGTS:186000,LOCAL:00:00:00.000

NOTE this is not a cue

1
00:00:01.480 --> 00:00:05.583 line:-3
 A German court has sentenced a 61-year old man

2
00:00:05.584 --> 00:00:11.184 line:-3
for repeatedly drugging his wife
and stealing from her

3
00:00:11.184 --> 00:00:11.184 line:-3
zero length, dropped
`

describe("parseTimestampToMs", () => {
  it("parses minute, hour, and comma-separated forms", () => {
    expect(parseTimestampToMs("00:00:00.360")).toBe(360)
    expect(parseTimestampToMs("01:02:03.400")).toBe(3_723_400)
    expect(parseTimestampToMs("02:03,500")).toBe(123_500)
    expect(parseTimestampToMs("00:00:07")).toBe(7_000)
  })

  it("returns null for values that are not timestamps", () => {
    expect(parseTimestampToMs(undefined)).toBeNull()
    expect(parseTimestampToMs("soon")).toBeNull()
    expect(parseTimestampToMs("00")).toBeNull()
  })

  it("accepts the mm:ss form WebVTT allows", () => {
    expect(parseTimestampToMs("01:23.456")).toBe(83_456)
  })
})

describe("parseTtmlCues", () => {
  it("maps paragraphs to cues and drops zero-length ones", () => {
    expect(parseTtmlCues(TTML_SAMPLE)).toEqual([
      { text: "The yen has been at levels not seen in four", start: 360, end: 3680 },
      { text: "decades this year.", start: 3680, end: 4800 },
      { text: "for 164 yen & one dollar", start: 7560, end: 9200 },
      { text: "In July 2026", start: 9200, end: 13_480 },
    ])
  })

  it("returns nothing for a document without captions", () => {
    expect(parseTtmlCues('<?xml version="1.0"?><tt><body><div /></body></tt>')).toEqual([])
  })
})

describe("parseVttCues", () => {
  it("maps cues, keeps multi-line payloads on one line, and skips notes", () => {
    expect(parseVttCues(VTT_SAMPLE)).toEqual([
      {
        text: "A German court has sentenced a 61-year old man",
        start: 1480,
        end: 5583,
      },
      {
        text: "for repeatedly drugging his wife and stealing from her",
        start: 5584,
        end: 11_184,
      },
    ])
  })

  it("returns nothing for a header-only file", () => {
    expect(parseVttCues("WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:186000,LOCAL:00:00:00.000\n")).toEqual([])
  })
})
