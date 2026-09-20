#!/usr/bin/env node
/**
 * Builds the learning-mode dictionary artifacts.
 *
 * Two variants are emitted from one pass over the upstream rows so they cannot
 * drift apart: `lite` is small enough to import on a laptop, `full` carries the
 * long tail. Both are read back from `chrome.storage.local` by the content
 * script, so the entry field names are single letters and empty fields are
 * dropped rather than nulled. `src/utils/learning-mode/types.ts` owns the shape
 * and `README.md` next to this file documents the artifact contract.
 *
 * Sources:
 * - ECDICT (MIT) for headwords, phonetics, senses, exam tags, ranks, inflections
 * - CEFR-J / Octanove profiles (Open Language Profiles) for CEFR bands
 * - ECDICT's lemma list for lemmas the `exchange` column does not carry
 *
 * Usage: node scripts/learning-mode/build-dictionary.mjs [--force] [--skip-c1c2]
 */

import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath } from "node:url"
import { gzipSync } from "node:zlib"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const CACHE_DIR = join(SCRIPT_DIR, ".cache")
const OUT_DIR = resolve(SCRIPT_DIR, "..", "..", "dist", "learning-mode")

const ECDICT_REPO = "https://github.com/skywind3000/ECDICT"
const ECDICT_RAW = "https://raw.githubusercontent.com/skywind3000/ECDICT/master"
const ECDICT_FILES = {
  mini: { url: `${ECDICT_RAW}/ecdict.mini.csv`, file: "ecdict.mini.csv" },
  full: { url: `${ECDICT_RAW}/ecdict.csv`, file: "ecdict.csv" },
}
const LEMMA_LIST = { url: `${ECDICT_RAW}/lemma.en.txt`, file: "lemma.en.txt" }
/**
 * Upstream replaced the real mini dictionary with a ~4 KB sample. A dictionary
 * smaller than this cannot carry the common words the feature highlights, so it
 * is treated as missing rather than imported.
 */
const MIN_PLAUSIBLE_ECDICT_BYTES = 1 << 20

const CEFR_REPO = "openlanguageprofiles/olp-en-cefrj"
const CEFR_BRANCH = "master"
const CEFR_RAW = `https://raw.githubusercontent.com/${CEFR_REPO}/${CEFR_BRANCH}`
const CEFR_CSV_PATTERN = /^cefrj-vocabulary-profile-.*\.csv$/i
const C1C2_CSV_PATTERN = /^octanove-vocabulary-profile-c1c2-.*\.csv$/i
/** Used only when the repository cannot be listed; both exist as of this build. */
const CEFR_CSV_FALLBACK = "cefrj-vocabulary-profile-1.5.csv"
const C1C2_CSV_FALLBACK = "octanove-vocabulary-profile-c1c2-1.0.csv"

const VARIANT_LIMITS = { lite: 20_000, full: 60_000 }

const EXAM_TAGS = ["zk", "gk", "cet4", "cet6", "ky", "toefl", "ielts", "gre"]
const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]

/** ECDICT's documented column order, used when the header row is missing. */
const ECDICT_COLUMNS = [
  "word",
  "phonetic",
  "definition",
  "translation",
  "pos",
  "collins",
  "oxford",
  "tag",
  "bnc",
  "frq",
  "exchange",
  "detail",
  "audio",
]

class BuildError extends Error {}

const options = { force: false, skipC1C2: false, help: false }

function parseArgv(argv) {
  for (const arg of argv) {
    switch (arg) {
      case "--force":
        options.force = true
        break
      case "--skip-c1c2":
        options.skipC1C2 = true
        break
      case "--help":
      case "-h":
        options.help = true
        break
      default:
        throw new BuildError(`unknown option "${arg}"`)
    }
  }
}

function printUsage() {
  console.log(
    [
      "Builds dist/learning-mode/dictionary-{lite,full}.json + manifest.json.",
      "",
      "  --force       re-download every source instead of reusing .cache/",
      "  --skip-c1c2   skip the Octanove C1/C2 profile (CEFR-J covers A1-B2)",
      "  --help        show this message",
    ].join("\n"),
  )
}

function log(message) {
  console.log(message)
}

function warn(message) {
  console.warn(`warning: ${message}`)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function fileSize(path) {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

/* ------------------------------------------------------------------ sources */

/**
 * Downloads once and reuses the file afterwards: the ECDICT dump is 66 MB and
 * the filters are meant to be tuned by rerunning this script.
 */
async function downloadToCache(source, { required }) {
  const dest = join(CACHE_DIR, source.file)
  if (!options.force) {
    const cached = await fileSize(dest)
    if (cached > 0) {
      log(`cached   ${source.file} (${formatBytes(cached)})`)
      return { ...source, path: dest, bytes: cached }
    }
  }

  let response
  try {
    response = await fetch(source.url, { redirect: "follow" })
  } catch (error) {
    if (required) throw new BuildError(`cannot reach ${source.url}: ${error.message}`)
    warn(`cannot reach ${source.url}: ${error.message}`)
    return null
  }

  if (!response.ok || !response.body) {
    if (required)
      throw new BuildError(`upstream returned HTTP ${response.status} for ${source.url}`)
    warn(`upstream returned HTTP ${response.status} for ${source.url}`)
    return null
  }

  await mkdir(CACHE_DIR, { recursive: true })
  const partial = `${dest}.part`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  await rename(partial, dest)

  const bytes = await fileSize(dest)
  log(`fetched  ${source.file} (${formatBytes(bytes)})`)
  return { ...source, path: dest, bytes }
}

async function fetchText(url) {
  try {
    const response = await fetch(url, { redirect: "follow" })
    if (!response.ok) return null
    return await response.text()
  } catch {
    return null
  }
}

async function downloadFirst(urls, file, { required, label }) {
  const candidates = [...new Set(urls)]
  for (const url of candidates) {
    const source = await downloadToCache({ url, file }, { required: false })
    if (source) return source
  }
  if (required) {
    throw new BuildError(`no ${label} source could be downloaded (tried ${candidates.join(", ")})`)
  }
  warn(`no ${label} source could be downloaded; continuing without it`)
  return null
}

async function resolveEcdict() {
  const mini = await downloadToCache(ECDICT_FILES.mini, { required: false })
  if (mini && mini.bytes >= MIN_PLAUSIBLE_ECDICT_BYTES) return mini
  if (mini) {
    warn(
      `${mini.file} is only ${formatBytes(mini.bytes)} (upstream ships a sample, not a dictionary); using ecdict.csv instead`,
    )
  }
  const full = await downloadToCache(ECDICT_FILES.full, { required: false })
  if (full) return full
  throw new BuildError(
    `no ECDICT dictionary could be downloaded (tried ${ECDICT_FILES.mini.url}, ${ECDICT_FILES.full.url})`,
  )
}

/**
 * The CSV names carry their version, so they are discovered rather than trusted:
 * the GitHub API is the cheapest route, the README is the fallback while the API
 * is rate limited, and the constants above are the last resort.
 */
async function discoverCefrFiles() {
  const tree = await fetchText(
    `https://api.github.com/repos/${CEFR_REPO}/git/trees/${CEFR_BRANCH}?recursive=1`,
  )
  if (tree) {
    try {
      const parsed = JSON.parse(tree)
      const paths = Array.isArray(parsed.tree)
        ? parsed.tree
            .map((node) => node.path)
            .filter((path) => typeof path === "string" && path.endsWith(".csv"))
        : []
      if (paths.length > 0) {
        log(`listed   ${CEFR_REPO} via GitHub API`)
        return paths
      }
    } catch {
      warn("GitHub API returned a body that is not a file tree")
    }
  }

  const readme = await fetchText(`${CEFR_RAW}/README.md`)
  const linked = readme ? [...new Set(readme.match(/[\w.-]+\.csv/g) ?? [])] : []
  if (linked.length > 0) {
    log(`listed   ${CEFR_REPO} via its README`)
    return linked
  }

  warn(`could not list ${CEFR_REPO}; falling back to the file names known at build time`)
  return []
}

/** Picks the highest `N.N` version among the paths matching a pattern. */
function pickNewest(paths, pattern) {
  let best = null
  let bestScore = -1
  for (const path of paths) {
    const name = basename(path)
    if (!pattern.test(name)) continue
    const version = /(\d+)\.(\d+)/.exec(name)
    const score = version ? Number(version[1]) * 1000 + Number(version[2]) : 0
    if (score > bestScore) {
      best = path
      bestScore = score
    }
  }
  return best
}

async function resolveCefrSources() {
  const listed = await discoverCefrFiles()
  const sources = []

  const profile = pickNewest(listed, CEFR_CSV_PATTERN) ?? CEFR_CSV_FALLBACK
  sources.push(
    await downloadFirst(
      [profile, CEFR_CSV_FALLBACK].map((path) => `${CEFR_RAW}/${path}`),
      basename(profile),
      {
        required: true,
        label: "CEFR-J vocabulary profile",
      },
    ),
  )

  if (!options.skipC1C2) {
    const c1c2 = pickNewest(listed, C1C2_CSV_PATTERN) ?? C1C2_CSV_FALLBACK
    const source = await downloadFirst(
      [c1c2, C1C2_CSV_FALLBACK].map((path) => `${CEFR_RAW}/${path}`),
      basename(c1c2),
      { required: false, label: "Octanove C1/C2 profile" },
    )
    if (source) sources.push(source)
  }

  return sources
}

/* --------------------------------------------------------------------- csv */

const CSV_STRUCTURAL = /["\r\n,]/g

function findStructural(buffer, from) {
  CSV_STRUCTURAL.lastIndex = from
  const match = CSV_STRUCTURAL.exec(buffer)
  return match ? match.index : buffer.length
}

/**
 * A quote-aware record reader. ECDICT keeps commas and newlines inside quoted
 * cells, so the file cannot be split on newlines; chunk boundaries can also land
 * inside a quoted field, which is why the scan state survives across chunks.
 */
async function* readCsvRecords(chunks) {
  let buffer = ""
  let field = ""
  let record = []
  let inQuotes = false

  for await (const chunk of chunks) {
    buffer += chunk
    let index = 0

    while (index < buffer.length) {
      const char = buffer[index]

      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote; a quote on
        // the last buffered character is ambiguous until the next chunk arrives.
        if (index + 1 >= buffer.length) break
        if (inQuotes && buffer[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        inQuotes = !inQuotes
        index += 1
        continue
      }

      if (inQuotes) {
        const quote = buffer.indexOf('"', index)
        const stop = quote === -1 ? buffer.length : quote
        field += buffer.slice(index, stop)
        index = stop
        continue
      }

      if (char === ",") {
        record.push(field)
        field = ""
        index += 1
        continue
      }
      if (char === "\n") {
        record.push(field)
        field = ""
        yield record
        record = []
        index += 1
        continue
      }
      if (char === "\r") {
        index += 1
        continue
      }

      const stop = findStructural(buffer, index)
      field += buffer.slice(index, stop)
      index = stop
    }

    buffer = buffer.slice(index)
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field)
    yield record
  }
}

async function parseCsvText(text) {
  const records = []
  for await (const record of readCsvRecords([text])) records.push(record)
  return records
}

function readHeader(record) {
  return record.map((cell) =>
    cell
      .replace(/^\ufeff/, "")
      .trim()
      .toLowerCase(),
  )
}

/* ------------------------------------------------------------------ sources */

function addCefrBand(bands, headword, level) {
  // CEFR-J lists spelling variants in one cell, e.g. `a.m./A.M./am/AM`.
  for (const variant of headword.split("/")) {
    const key = variant.trim().toLowerCase()
    if (!key) continue
    const current = bands.get(key)
    // Several rows share a headword across parts of speech; the easiest band
    // wins so a word counts as known as early as the profile can allow.
    if (current === undefined || CEFR_LEVELS.indexOf(level) < CEFR_LEVELS.indexOf(current)) {
      bands.set(key, level)
    }
  }
}

async function loadCefrBands(sources) {
  const bands = new Map()
  for (const source of sources) {
    const records = await parseCsvText(await readFile(source.path, "utf8"))
    if (records.length < 2) {
      warn(`${source.file} holds no rows`)
      continue
    }

    const header = readHeader(records[0])
    const headwordIndex = header.indexOf("headword")
    const levelIndex = header.indexOf("cefr")
    if (headwordIndex === -1 || levelIndex === -1) {
      throw new BuildError(
        `${source.file} has no headword/CEFR columns (header: ${header.join(",")})`,
      )
    }

    let rows = 0
    for (const record of records.slice(1)) {
      const headword = (record[headwordIndex] ?? "").trim()
      const level = (record[levelIndex] ?? "").trim().toUpperCase()
      if (!headword || !CEFR_LEVELS.includes(level)) continue
      addCefrBand(bands, headword, level)
      rows += 1
    }
    log(`joined   ${source.file}: ${rows} rows`)
  }
  return bands
}

/**
 * `lemma.en.txt` maps a lemma to its inflections; the dictionary needs the
 * reverse, so the file is inverted. `exchange` wins where both know a form,
 * because it also carries the inflected shapes a "known" verdict spreads to.
 */
async function loadLemmaList(path) {
  const lemmas = new Map()
  const text = await readFile(path, "utf8")
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith(";")) continue
    const [head, inflectionList] = line.split(" -> ")
    if (!inflectionList) continue
    const lemma = head.split("/")[0].trim().toLowerCase()
    if (!lemma) continue
    for (const inflection of inflectionList.split(",")) {
      const key = inflection.trim().toLowerCase()
      if (key && key !== lemma && !lemmas.has(key)) lemmas.set(key, lemma)
    }
  }
  return lemmas
}

/* ------------------------------------------------------------------- rows */

/**
 * ECDICT's `exchange` column is `type:form/type:form`; `0:` points at the lemma
 * of an inflected row. Returns "" when the row is itself a headword.
 */
function lemmaFromExchange(exchange) {
  for (const part of exchange.split("/")) {
    const separator = part.indexOf(":")
    if (separator > 0 && part.slice(0, separator) === "0") {
      return part
        .slice(separator + 1)
        .trim()
        .toLowerCase()
    }
  }
  return ""
}

function parseTags(raw) {
  const tags = []
  for (const tag of raw.trim().toLowerCase().split(/\s+/)) {
    if (tag !== "" && EXAM_TAGS.includes(tag) && !tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** `0` is ECDICT's "not in this corpus"; as a rank it would read as the most frequent word alive. */
function parseRank(raw) {
  const rank = Number.parseInt(raw.trim(), 10)
  return Number.isFinite(rank) && rank > 0 ? rank : undefined
}

function parseSenses(raw) {
  if (raw === "") return undefined
  // One cell holds every sense, separated by literal `\n` escapes.
  const senses = []
  for (const line of raw.replaceAll("\\n", "\n").split("\n")) {
    const sense = line.trim()
    if (sense) senses.push(sense)
  }
  return senses.length > 0 ? senses : undefined
}

function addEntry(target, entry, rank, counters) {
  const existing = target.get(entry.w)
  if (existing === undefined) {
    target.set(entry.w, { entry, rank })
    return
  }
  counters.duplicates += 1
  // Case-folded collisions (`China`/`china`) are common; the better ranked row
  // is the one a reader is likelier to meet.
  if (rank !== undefined && (existing.rank === undefined || rank < existing.rank)) {
    target.set(entry.w, { entry, rank })
  }
}

function compareRanked(a, b) {
  const left = a.rank ?? Number.POSITIVE_INFINITY
  const right = b.rank ?? Number.POSITIVE_INFINITY
  if (left !== right) return left - right
  if (a.entry.w === b.entry.w) return 0
  return a.entry.w < b.entry.w ? -1 : 1
}

async function collectEntries(ecdict, bands, lemmaList) {
  const targets = { lite: new Map(), full: new Map() }
  const counters = { rows: 0, kept: 0, droppedNoSenses: 0, duplicates: 0 }

  let columns = null
  const stream = createReadStream(ecdict.path, { encoding: "utf8", highWaterMark: 1 << 20 })

  for await (const record of readCsvRecords(stream)) {
    if (columns === null) {
      const header = readHeader(record)
      if (header[0] === "word") {
        columns = Object.fromEntries(header.map((name, index) => [name, index]))
        continue
      }
      warn(`${ecdict.file} has no header row; assuming ECDICT's documented column order`)
      columns = Object.fromEntries(ECDICT_COLUMNS.map((name, index) => [name, index]))
    }

    counters.rows += 1
    const word = (record[columns.word] ?? "").trim().toLowerCase()
    if (word === "") continue

    const exchange = (record[columns.exchange] ?? "").trim()
    const lemma = lemmaFromExchange(exchange) || lemmaList.get(word) || ""
    const tags = parseTags(record[columns.tag] ?? "")
    const frq = parseRank(record[columns.frq] ?? "")
    const bnc = parseRank(record[columns.bnc] ?? "")
    const rank = frq ?? bnc
    // A page token can miss the headword but hit the lemma, so both join.
    const cefr = bands.get(word) ?? (lemma === "" ? undefined : bands.get(lemma))
    const isExtra = tags.length > 0 || cefr !== undefined

    if (!isExtra && (rank === undefined || rank > VARIANT_LIMITS.full)) continue

    const translation = parseSenses(record[columns.translation] ?? "")
    const definition = parseSenses(record[columns.definition] ?? "")
    if (translation === undefined && definition === undefined) {
      counters.droppedNoSenses += 1
      continue
    }
    counters.kept += 1

    const entry = { w: word }
    if (lemma !== "" && lemma !== word) entry.l = lemma
    const phonetic = (record[columns.phonetic] ?? "").trim()
    if (phonetic !== "") entry.p = phonetic
    if (translation) entry.t = translation
    if (definition) entry.d = definition
    const pos = (record[columns.pos] ?? "").trim()
    if (pos !== "") entry.pos = pos
    const collins = Number.parseInt((record[columns.collins] ?? "").trim(), 10)
    if (Number.isFinite(collins) && collins >= 1 && collins <= 5) entry.col = collins
    if ((record[columns.oxford] ?? "").trim() === "1") entry.ox = 1
    if (tags.length > 0) entry.tags = tags
    if (frq !== undefined) entry.frq = frq
    if (bnc !== undefined) entry.bnc = bnc
    if (exchange !== "") entry.x = exchange
    if (cefr !== undefined) entry.cefr = cefr

    if (isExtra || (rank !== undefined && rank <= VARIANT_LIMITS.lite)) {
      addEntry(targets.lite, entry, rank, counters)
    }
    addEntry(targets.full, entry, rank, counters)
  }

  return { targets, counters }
}

/* ------------------------------------------------------------------ output */

/**
 * `meta.bytes` counts the file it is written into, so the number has to settle
 * against its own digit count before the JSON is final.
 */
function serializePayload(payload) {
  let bytes = 0
  let json = ""
  for (let pass = 0; pass < 4; pass += 1) {
    payload.meta.bytes = bytes
    json = JSON.stringify(payload)
    const actual = Buffer.byteLength(json, "utf8")
    if (actual === bytes) break
    bytes = actual
  }
  return { json, bytes: Buffer.byteLength(json, "utf8") }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function buildSourceList(sources) {
  const list = [
    {
      name: "ECDICT",
      url: sources.ecdict.url,
      license: "MIT",
      licenseUrl: `${ECDICT_REPO}/blob/master/LICENSE`,
    },
  ]

  for (const cefr of sources.cefr) {
    list.push(
      C1C2_CSV_PATTERN.test(cefr.file)
        ? {
            name: "Octanove Vocabulary Profile C1/C2",
            url: cefr.url,
            license: "CC BY-SA 4.0",
            licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
          }
        : {
            name: "CEFR-J Vocabulary Profile",
            url: cefr.url,
            license:
              "CEFR-J terms of use (free for research and commercial use with citation; © Tono Laboratory, TUFS)",
            licenseUrl: "https://github.com/openlanguageprofiles/olp-en-cefrj#terms-of-use",
          },
    )
  }

  if (sources.lemma) {
    list.push({
      name: "ECDICT lemma list",
      url: sources.lemma.url,
      license: "Free for research and educational use (per file header)",
      licenseUrl: `${ECDICT_REPO}/blob/master/lemma.en.txt`,
    })
  }

  return list
}

async function main() {
  parseArgv(process.argv.slice(2))
  if (options.help) {
    printUsage()
    return
  }

  await mkdir(OUT_DIR, { recursive: true })

  const ecdict = await resolveEcdict()
  const cefr = await resolveCefrSources()
  const lemma = await downloadToCache(LEMMA_LIST, { required: false })

  const bands = await loadCefrBands(cefr)
  const lemmaList = lemma ? await loadLemmaList(lemma.path) : new Map()
  if (lemma) log(`loaded   ${lemma.file}: ${lemmaList.size} inflected forms`)

  const { targets, counters } = await collectEntries(ecdict, bands, lemmaList)
  log(
    `read     ${counters.rows} rows: ${counters.kept} kept, ${counters.droppedNoSenses} without senses, ` +
      `${counters.duplicates} duplicate headwords`,
  )

  const importedAt = Date.now()
  const version = new Date(importedAt).toISOString().slice(0, 10)
  const source = `github.com/skywind3000/ECDICT + github.com/${CEFR_REPO}`

  const manifest = {
    version,
    builtAt: new Date(importedAt).toISOString(),
    variants: [],
    sources: buildSourceList({ ecdict, cefr, lemma }),
  }

  for (const variant of ["lite", "full"]) {
    const entries = [...targets[variant].values()].sort(compareRanked).map((ranked) => ranked.entry)
    const payload = {
      meta: { version, variant, entries: entries.length, bytes: 0, importedAt, source },
      entries,
    }
    const { json, bytes } = serializePayload(payload)

    if (payload.meta.entries !== entries.length) {
      throw new BuildError(`${variant} entry count drifted during serialization`)
    }

    const file = `dictionary-${variant}.json`
    const buffer = Buffer.from(json, "utf8")
    await writeFile(join(OUT_DIR, file), buffer)

    const written = await fileSize(join(OUT_DIR, file))
    if (written !== bytes)
      throw new BuildError(`${file} is ${written} bytes on disk but ${bytes} in meta`)

    const digest = sha256(buffer)
    const gzip = gzipSync(buffer).length
    manifest.variants.push({ variant, file, entries: entries.length, bytes, sha256: digest })

    log(
      `${variant.padEnd(4)} ${String(entries.length).padStart(7)} entries  ` +
        `${formatBytes(bytes).padStart(9)}  ${formatBytes(gzip).padStart(9)} gzip  sha256 ${digest}`,
    )
  }

  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(join(OUT_DIR, "manifest.json"), manifestJson, "utf8")

  log(`wrote    ${OUT_DIR}`)
  for (const record of manifest.sources) log(`source   ${record.name}: ${record.url}`)
}

main().catch((error) => {
  if (error instanceof BuildError) {
    console.error(`error: ${error.message}`)
  } else {
    console.error(error)
  }
  process.exitCode = 1
})
