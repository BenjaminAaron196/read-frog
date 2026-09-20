import type { LearningDictionaryMeta, LearningDictionaryPayload } from "./types"
import { z } from "zod"
import { browser } from "#imports"
import {
  LEARNING_DICTIONARY_ENTRIES_KEY,
  LEARNING_DICTIONARY_META_KEY,
} from "@/utils/constants/learning-mode"

/**
 * Fetching a published dictionary artifact, and writing one to extension storage.
 *
 * Both import paths meet here: the file picker and the one-click download decode the
 * same artifact and write the same two storage keys, so the checks that decide whether
 * a payload is trustworthy have one home. The download verifies the bytes it fetched —
 * size, digest, entry count — before anything is written: a rejected transfer has to
 * leave the previously imported dictionary exactly as it was, because a half-written
 * one reports entries that are not there.
 *
 * Only the options page fetches. An extension page is a secure context, so
 * `crypto.subtle` is there for the digest, and `fetch` reaches whichever hosts the
 * extension's `host_permissions` cover.
 */

export const DICTIONARY_VARIANTS = ["lite", "full"] as const
export type DictionaryVariant = (typeof DICTIONARY_VARIANTS)[number]

const variantSchema = z.enum(DICTIONARY_VARIANTS)

/**
 * One variant's record in `manifest.json`. `file` is resolved against the manifest's
 * own URL, so a mirror that publishes everything under one directory describes itself
 * in one word per file. `bytes` and `sha256` are the builder's own witness of what it
 * wrote, which is all a reader has to tell a complete transfer from a truncated one.
 */
const manifestRecordSchema = z.object({
  variant: variantSchema,
  file: z.string().min(1),
  entries: z.number().int().positive(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
})

/**
 * `manifest.json` as `scripts/learning-mode/build-dictionary.mjs` writes it. `builtAt`
 * and `sources` are provenance for a human, so they are not required: a manifest that
 * has been through a mirror or a formatter still describes a usable build.
 */
const manifestSchema = z.object({
  version: z.string().min(1),
  builtAt: z.string().optional(),
  variants: z.array(manifestRecordSchema).min(1),
  sources: z
    .array(
      z.looseObject({
        name: z.string().min(1),
        url: z.string().min(1),
        license: z.string().optional(),
        licenseUrl: z.string().optional(),
      }),
    )
    .optional(),
})

export type DictionaryManifest = z.infer<typeof manifestSchema>
export type DictionaryManifestRecord = z.infer<typeof manifestRecordSchema>

/**
 * Why an artifact was not imported. Each code is one sentence in the settings page
 * plus the values that sentence interpolates, so the download layer stays free of
 * localized text and a test can assert on the reason without matching a translation.
 */
export type DictionaryImportErrorCode =
  /** The request never completed: offline, DNS, TLS, CORS. */
  | "network"
  /** The server answered, but not with 2xx. */
  | "http"
  /** The response carried no body to read. */
  | "empty"
  /** The document at the manifest URL is missing, unreadable, or not a manifest. */
  | "manifest"
  /** The manifest lists no build of the variant that is being imported. */
  | "variant"
  /** No source is configured, or one of them is not an absolute http(s) URL. */
  | "source"
  /** A picked file is shorter than the size it declares: it lost bytes on the way. */
  | "truncated"
  /** The artifact's own size is not the one the manifest published. */
  | "size"
  /** The payload's sha256 is not the one the manifest published. */
  | "checksum"
  /** The entry count on record is not the number of rows the artifact carries. */
  | "entries"
  /** The payload is not a Read Frog dictionary artifact at all. */
  | "invalidFile"
  /** A row has no usable lower-case headword. */
  | "invalidEntries"
  /** The artifact declares a different variant than the one being imported. */
  | "variantMismatch"

/**
 * A rejection the settings page can explain: `code` picks the sentence, `params` are
 * the values it interpolates, and the message is the English one-liner that reaches
 * `message` for logs and for anything that does not know the code.
 */
export class DictionaryImportError extends Error {
  readonly code: DictionaryImportErrorCode
  readonly params: readonly string[]

  constructor(code: DictionaryImportErrorCode, reason: string, params: readonly string[] = []) {
    super(reason)
    this.name = "DictionaryImportError"
    this.code = code
    this.params = params
  }
}

/** Magic-constant arithmetic worth a name of its own; the call sites read numbers. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function describeThrown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** An abort is the reader closing the page, not a source that failed. */
function rethrowAbort(error: unknown): void {
  if (error instanceof Error && error.name === "AbortError") throw error
}

/**
 * The manifest URL a configured source points at: a base URL gets `manifest.json`
 * appended, and a URL that already names a `.json` file is taken as the manifest
 * itself, which is how a mirror or a local server tends to be addressed.
 *
 * Returns null for anything that cannot be fetched — a relative path, a `file:` URL,
 * a mistyped scheme. That is also the test the settings page runs before it stores a
 * source, so a line nobody can fetch never reaches the list.
 */
export function resolveManifestUrl(source: string): string | null {
  const trimmed = source.trim()
  if (trimmed === "") return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  // The two schemes an extension page can actually fetch.
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  if (url.pathname.endsWith(".json")) return url.toString()

  // Relative resolution drops the last path segment when there is no trailing slash,
  // which would turn `https://host/dict` into `https://host/manifest.json`.
  if (!url.pathname.endsWith("/")) url.pathname += "/"
  return new URL("manifest.json", url).toString()
}

export interface ResolvedDictionarySource {
  /** The configured source this came from, as the reader typed it. */
  source: string
  /** Absolute URL the manifest was read from. */
  manifestUrl: string
  manifest: DictionaryManifest
  /** The manifest's record for the variant that is being imported. */
  record: DictionaryManifestRecord
}

export interface SourceRequestOptions {
  signal?: AbortSignal
}

async function fetchOrFail(url: string, signal?: AbortSignal): Promise<Response> {
  let response: Response
  try {
    // `no-store`: a cached manifest or artifact is another build's file under the same
    // name, and a stale copy would look like a corrupt download rather than a cache hit.
    response = await fetch(url, { signal, cache: "no-store" })
  } catch (error) {
    rethrowAbort(error)
    throw new DictionaryImportError("network", `cannot reach ${url}: ${describeThrown(error)}`, [
      url,
    ])
  }

  if (!response.ok) {
    throw new DictionaryImportError("http", `${url} answered HTTP ${response.status}`, [
      String(response.status),
      url,
    ])
  }

  return response
}

async function fetchTextOrFail(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchOrFail(url, signal)
  try {
    return await response.text()
  } catch (error) {
    rethrowAbort(error)
    throw new DictionaryImportError(
      "network",
      `${url} could not be read: ${describeThrown(error)}`,
      [url],
    )
  }
}

async function readManifest(
  source: string,
  manifestUrl: string,
  variant: DictionaryVariant,
  signal?: AbortSignal,
): Promise<ResolvedDictionarySource> {
  const text = await fetchTextOrFail(manifestUrl, signal)

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new DictionaryImportError("manifest", `${manifestUrl} is not JSON`, [manifestUrl])
  }

  const manifest = manifestSchema.safeParse(parsed)
  if (!manifest.success) {
    throw new DictionaryImportError("manifest", `${manifestUrl} is not a dictionary manifest`, [
      manifestUrl,
    ])
  }

  const record = manifest.data.variants.find((candidate) => candidate.variant === variant)
  if (!record) {
    throw new DictionaryImportError("variant", `${manifestUrl} lists no ${variant} build`, [
      variant,
    ])
  }

  return { source, manifestUrl, manifest: manifest.data, record }
}

/**
 * Probes the configured sources in order and keeps the first that serves a manifest
 * carrying the requested variant: a list of sources is a list of mirrors, so the first
 * answer wins and one broken host must not hide a working one. When every source
 * fails, the first failure is the one raised — it is the one the reader listed first,
 * and the later ones were only tried because it did not answer.
 */
export async function resolveDictionarySource(
  sources: readonly string[],
  variant: DictionaryVariant,
  { signal }: SourceRequestOptions = {},
): Promise<ResolvedDictionarySource> {
  let firstFailure: DictionaryImportError | null = null

  for (const source of sources) {
    const manifestUrl = resolveManifestUrl(source)
    if (manifestUrl === null) {
      firstFailure ??= new DictionaryImportError("source", `${source} is not an http(s) URL`, [
        source,
      ])
      continue
    }

    try {
      return await readManifest(source, manifestUrl, variant, signal)
    } catch (error) {
      rethrowAbort(error)
      firstFailure ??=
        error instanceof DictionaryImportError
          ? error
          : new DictionaryImportError("manifest", describeThrown(error), [manifestUrl])
    }
  }

  throw firstFailure ?? new DictionaryImportError("source", "no dictionary source is configured")
}

export interface DictionaryDownloadProgress {
  /** Bytes received so far. */
  received: number
  /**
   * What the server declared, or null when it declared nothing: a chunked or HTTP/2
   * response carries no `Content-Length`, and the bar stays indeterminate.
   */
  total: number | null
}

export interface DictionaryDownloadOptions extends SourceRequestOptions {
  /** Called once per chunk: the settings page shows the bytes, the bar follows them. */
  onProgress?: (progress: DictionaryDownloadProgress) => void
}

/** The manifest names two builds; the sentence names the two digests by their start. */
const DIGEST_PREFIX_LENGTH = 12

/**
 * Lower-case hex, the form `createHash("sha256")` writes in the build script. The
 * parameter is the one view of a `Uint8Array` `crypto.subtle` accepts.
 */
async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

/**
 * Downloads the file the resolved manifest points at, verifies it against that
 * manifest, and returns the decoded payload. Storage is not touched here: the write
 * happens only after this has either returned a verified payload or thrown, which is
 * what keeps a failed transfer from leaving a half-written dictionary behind.
 */
export async function downloadDictionaryVariant(
  resolved: ResolvedDictionarySource,
  { signal, onProgress }: DictionaryDownloadOptions = {},
): Promise<LearningDictionaryPayload> {
  const { manifestUrl, record, source } = resolved

  let fileUrl: string
  try {
    fileUrl = new URL(record.file, manifestUrl).toString()
  } catch {
    throw new DictionaryImportError(
      "manifest",
      `${manifestUrl} names an unusable file: ${record.file}`,
      [manifestUrl],
    )
  }

  const response = await fetchOrFail(fileUrl, signal)
  const body = response.body
  if (body === null) {
    throw new DictionaryImportError("empty", `${fileUrl} sent no body`, [fileUrl])
  }

  const declaredLength = Number(response.headers.get("content-length"))
  const total = Number.isInteger(declaredLength) && declaredLength > 0 ? declaredLength : null

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    chunks.push(chunk.value)
    received += chunk.value.byteLength
    onProgress?.({ received, total })
  }

  if (received !== record.bytes) {
    throw new DictionaryImportError(
      "size",
      `${fileUrl} is ${received} bytes, the manifest lists ${record.bytes}`,
      [formatBytes(record.bytes), formatBytes(received)],
    )
  }

  // One flat buffer: the digest covers the whole artifact, and `crypto.subtle` takes
  // contiguous bytes. The chunks are copied once, and the decoded text is the string
  // `JSON.parse` needs anyway — neither copy can be avoided, and neither is repeated.
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  const digest = await sha256Hex(bytes)
  const publishedDigest = record.sha256.toLowerCase()
  if (digest !== publishedDigest) {
    throw new DictionaryImportError(
      "checksum",
      `${fileUrl} hashes to ${digest}, the manifest published ${publishedDigest}`,
      [publishedDigest.slice(0, DIGEST_PREFIX_LENGTH), digest.slice(0, DIGEST_PREFIX_LENGTH)],
    )
  }

  return parseDictionaryArtifact(new TextDecoder().decode(bytes), {
    variant: record.variant,
    source,
    bytes: received,
    countedBy: "manifest",
    entries: record.entries,
  })
}

/**
 * What an artifact has to be. `meta` is checked field by field because that is where a
 * wrong file shows itself first; of the entries only the headword is, both because a
 * row without one would sit in the dictionary unseen and because a build script wrote
 * the other twelve fields — a page token is lowercased before it is looked up, so an
 * upper-case headword would never match one.
 */
const artifactSchema = z.object({
  meta: z.object({
    version: z.string().min(1),
    variant: variantSchema,
    entries: z.number().int().nonnegative().optional(),
    /** Byte length of the artifact file itself, as the builder wrote it. */
    bytes: z.number().nonnegative().optional(),
    importedAt: z.number().optional(),
    source: z.string().optional(),
  }),
  entries: z.array(z.looseObject({ w: z.string().regex(/^[^A-Z]+$/) })).min(1),
})

export interface DictionaryArtifactExpectation {
  /** The variant the reader asked for. */
  variant: DictionaryVariant
  /** What the status line shows as this copy's origin: a source URL or a file name. */
  source: string
  /** Byte count of the artifact as the caller received it. */
  bytes: number
  /**
   * Where that count came from. A download's count comes from a manifest that published
   * this exact file, so the artifact's own `meta.bytes` has to agree with it. A picked
   * file's count is only what the picker reported, and there only a file SHORTER than
   * its claim lost bytes on the way to disk — a longer one was re-serialized by an
   * editor, which changes the byte count and nothing about the rows.
   */
  countedBy: "manifest" | "picker"
  /** Entry count some producer stated independently of the artifact, when there is one. */
  entries?: number
}

/**
 * Decodes an artifact and rewrites its meta for storage, or throws the reason it cannot
 * be one. Every rejection here is something the reader can act on: the other variant, a
 * truncated download, a manifest for another build, or a file Read Frog did not write.
 *
 * `entries.length` is authoritative once the array is in hand — the stored count is
 * rewritten from it — and any count the caller knows independently is cross-checked
 * against it.
 */
export function parseDictionaryArtifact(
  text: string,
  expectation: DictionaryArtifactExpectation,
): LearningDictionaryPayload {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new DictionaryImportError("invalidFile", "the payload is not JSON")
  }

  const artifact = artifactSchema.safeParse(parsed)
  if (!artifact.success) {
    const rowIssue = artifact.error.issues.find((issue) => issue.path[0] === "entries")
    if (rowIssue) {
      const row = Number(rowIssue.path[1]) + 1
      throw new DictionaryImportError("invalidEntries", `entry ${row} has no headword`, [
        String(row),
      ])
    }
    throw new DictionaryImportError("invalidFile", "the payload is not a dictionary artifact")
  }

  const { meta, entries } = artifact.data

  if (meta.variant !== expectation.variant) {
    throw new DictionaryImportError(
      "variantMismatch",
      `the artifact is the ${meta.variant} variant, ${expectation.variant} was requested`,
      [meta.variant],
    )
  }

  if (meta.bytes !== undefined) {
    if (expectation.countedBy === "manifest" && meta.bytes !== expectation.bytes) {
      throw new DictionaryImportError(
        "size",
        `the artifact declares ${meta.bytes} bytes, the manifest lists ${expectation.bytes}`,
        [formatBytes(expectation.bytes), formatBytes(meta.bytes)],
      )
    }
    if (expectation.countedBy === "picker" && meta.bytes > expectation.bytes) {
      throw new DictionaryImportError(
        "truncated",
        `the file declares ${meta.bytes} bytes but is ${expectation.bytes}`,
        [formatBytes(meta.bytes), formatBytes(expectation.bytes)],
      )
    }
  }

  const declaredEntries = expectation.entries ?? meta.entries
  if (declaredEntries !== undefined && declaredEntries !== entries.length) {
    throw new DictionaryImportError(
      "entries",
      `${declaredEntries} entries were declared, the artifact carries ${entries.length}`,
      [String(declaredEntries), String(entries.length)],
    )
  }

  return {
    // Import time, not build time: the status shows when THIS copy arrived.
    meta: {
      version: meta.version,
      variant: meta.variant,
      entries: entries.length,
      // The caller counted the bytes it received, which is what the status line should
      // report: a re-serialized file weighs what it weighs, whatever its meta claims.
      bytes: expectation.bytes,
      importedAt: Date.now(),
      // The builder's provenance line names the corpora the rows came from, which a
      // file name does not; a re-serialized artifact that lost it still says where this
      // copy came from.
      source: meta.source ?? expectation.source,
    },
    // The rows are the builder's compact shape; the schema pins the one field every
    // consumer reads and the rest are read defensively downstream.
    entries,
  }
}

/**
 * Writes both storage keys or neither: a meta without its entries would report a
 * dictionary that marks nothing, and the reverse is no better. Both import paths come
 * through here, so a payload can only reach storage through one door.
 */
export async function importDictionaryPayload(
  payload: LearningDictionaryPayload,
): Promise<LearningDictionaryMeta> {
  const { meta, entries } = payload
  await browser.storage.local.set({
    [LEARNING_DICTIONARY_META_KEY]: meta,
    [LEARNING_DICTIONARY_ENTRIES_KEY]: entries,
  })
  return meta
}

export interface DictionaryImportResult {
  meta: LearningDictionaryMeta
  /** The source that answered, as the reader typed it. */
  source: string
  manifestUrl: string
}

/**
 * The one-click path the settings page runs: probe the sources, download the variant,
 * verify it, and only then write. There is no way past the checks below to storage —
 * `importDictionaryPayload` is reached with a payload whose size, digest and entry
 * count all matched the manifest it came from.
 */
export async function downloadAndImportDictionary(
  sources: readonly string[],
  variant: DictionaryVariant,
  options: DictionaryDownloadOptions = {},
): Promise<DictionaryImportResult> {
  const resolved = await resolveDictionarySource(sources, variant, options)
  const payload = await downloadDictionaryVariant(resolved, options)
  const meta = await importDictionaryPayload(payload)
  return { meta, source: resolved.source, manifestUrl: resolved.manifestUrl }
}
