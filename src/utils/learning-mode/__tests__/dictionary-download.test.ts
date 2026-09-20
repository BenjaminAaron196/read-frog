// @vitest-environment jsdom

import type { DictionaryDownloadProgress } from "../dictionary-download"
import { createHash, webcrypto } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "#imports"
import {
  LEARNING_DICTIONARY_ENTRIES_KEY,
  LEARNING_DICTIONARY_META_KEY,
} from "@/utils/constants/learning-mode"
import { downloadAndImportDictionary } from "../dictionary-download"

// jsdom implements no SubtleCrypto, and the digest is what half of this suite pins:
// Node ships the same WebCrypto the extension page runs.
Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true })

const SOURCE = "https://dictionary.example.com/"
const MANIFEST_URL = `${SOURCE}manifest.json`
const FILE_URL = `${SOURCE}dictionary-lite.json`

/**
 * The artifact shape the build script writes, trimmed to two entries. `meta.bytes`
 * counts the file around it — the builder solves for its own digit count, and the
 * download refuses a payload whose declaration disagrees with the manifest.
 */
function buildArtifact(): { json: string; bytes: number; sha256: string } {
  const payload = {
    meta: {
      version: "2026-09-20",
      variant: "lite",
      entries: 2,
      bytes: 0,
      importedAt: 1_700_000_000_000,
      source: "github.com/skywind3000/ECDICT",
    },
    entries: [
      { w: "perceive", frq: 3200, cefr: "B1" },
      { w: "perceived", l: "perceive", frq: 5100 },
    ],
  }

  let json = JSON.stringify(payload)
  let bytes = new TextEncoder().encode(json).length
  while (payload.meta.bytes !== bytes) {
    payload.meta.bytes = bytes
    json = JSON.stringify(payload)
    bytes = new TextEncoder().encode(json).length
  }

  return { json, bytes, sha256: createHash("sha256").update(json).digest("hex") }
}

/** A manifest describing that artifact, with whichever record fields a case needs off. */
function buildManifest(
  artifact: { bytes: number; sha256: string },
  record: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    version: "2026-09-20",
    builtAt: "2026-09-20T03:16:02.680Z",
    variants: [
      {
        variant: "lite",
        file: "dictionary-lite.json",
        entries: 2,
        bytes: artifact.bytes,
        sha256: artifact.sha256,
        ...record,
      },
    ],
    sources: [{ name: "ECDICT", url: "https://github.com/skywind3000/ECDICT", license: "MIT" }],
  })
}

/** The two URLs this suite fetches, served from memory: a one-file host with no other routes. */
function serve(manifest: string, artifact: string) {
  return vi.fn<(url: string) => Promise<Response>>(async (url) => {
    if (url === MANIFEST_URL) return new Response(manifest, { status: 200 })
    if (url === FILE_URL) return new Response(artifact, { status: 200 })
    return new Response("not found", { status: 404 })
  })
}

describe("downloadAndImportDictionary", () => {
  // The suite's fake browser is the one the module reaches, so the write is observed on
  // it rather than on a mock of the module — "nothing was written" is the whole point.
  const setMock = vi.fn<(items: Record<string, unknown>) => Promise<void>>()

  beforeEach(() => {
    setMock.mockReset()
    setMock.mockResolvedValue()
    browser.storage.local.set = setMock
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("refuses a manifest that is not the shape the builder writes, and writes nothing", async () => {
    // No `sha256`: a manifest that cannot vouch for the bytes it serves has to stop the
    // download before it spends the transfer.
    const malformed = JSON.stringify({
      version: "2026-09-20",
      variants: [{ variant: "lite", file: "dictionary-lite.json", entries: 2, bytes: 1024 }],
    })
    const fetchMock = serve(malformed, buildArtifact().json)
    vi.stubGlobal("fetch", fetchMock)

    await expect(downloadAndImportDictionary([SOURCE], "lite")).rejects.toMatchObject({
      code: "manifest",
    })

    // The shape was the problem, not the address: the manifest was reached, and the
    // artifact behind it never was.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MANIFEST_URL])
    expect(setMock).not.toHaveBeenCalled()
  })

  it("refuses an artifact whose sha256 is not the published one, and writes nothing", async () => {
    const artifact = buildArtifact()
    const fetchMock = serve(buildManifest(artifact, { sha256: "0".repeat(64) }), artifact.json)
    vi.stubGlobal("fetch", fetchMock)

    await expect(downloadAndImportDictionary([SOURCE], "lite")).rejects.toMatchObject({
      code: "checksum",
    })

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([MANIFEST_URL, FILE_URL])
    expect(setMock).not.toHaveBeenCalled()
  })

  it("refuses a body whose size is not the one the manifest published, and writes nothing", async () => {
    const artifact = buildArtifact()
    // The manifest promises one byte more than the host serves: a truncated transfer.
    // The digest is never reached — the byte count has already disagreed.
    vi.stubGlobal(
      "fetch",
      serve(buildManifest(artifact, { bytes: artifact.bytes + 1 }), artifact.json),
    )

    await expect(downloadAndImportDictionary([SOURCE], "lite")).rejects.toMatchObject({
      code: "size",
    })

    expect(setMock).not.toHaveBeenCalled()
  })

  it("writes both storage keys once the digest and the entry count check out", async () => {
    const artifact = buildArtifact()
    vi.stubGlobal("fetch", serve(buildManifest(artifact), artifact.json))

    const progress: DictionaryDownloadProgress[] = []
    const result = await downloadAndImportDictionary([SOURCE], "lite", {
      onProgress: (update) => progress.push(update),
    })

    expect(result.source).toBe(SOURCE)
    expect(setMock).toHaveBeenCalledTimes(1)
    expect(setMock.mock.calls[0]![0]).toEqual({
      [LEARNING_DICTIONARY_META_KEY]: {
        version: "2026-09-20",
        variant: "lite",
        entries: 2,
        bytes: artifact.bytes,
        importedAt: expect.any(Number),
        source: "github.com/skywind3000/ECDICT",
      },
      [LEARNING_DICTIONARY_ENTRIES_KEY]: [
        { w: "perceive", frq: 3200, cefr: "B1" },
        { w: "perceived", l: "perceive", frq: 5100 },
      ],
    })
    // Progress follows the bytes actually received, and reaches the whole file.
    expect(progress.at(-1)?.received).toBe(artifact.bytes)
  })
})
