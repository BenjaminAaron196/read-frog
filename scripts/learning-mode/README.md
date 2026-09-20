# Learning-mode dictionary

`build-dictionary.mjs` turns two upstream word lists into the artifacts the
extension imports from the options page (Settings → Learning mode → Dictionary).
Everything is emitted in one pass so the `lite` and `full` variants cannot drift.

```sh
node scripts/learning-mode/build-dictionary.mjs [--force] [--skip-c1c2]
```

| flag          | effect                                                      |
| ------------- | ----------------------------------------------------------- |
| `--force`     | re-download every source instead of reusing `.cache/`       |
| `--skip-c1c2` | skip the Octanove C1/C2 profile (CEFR-J alone covers A1–B2) |

Downloads are cached in `scripts/learning-mode/.cache/` and reused, so reruns
after the first cost only the row pass (~3 s). Missing ECDICT or CEFR-J sources
end the build with a non-zero exit and no partial artifact; the optional sources
(the C1/C2 profile, the lemma list) only warn.

## Artifacts

`dist/learning-mode/dictionary-lite.json`, `dictionary-full.json` — payloads of
the shape declared in `src/utils/learning-mode/types.ts`:

```jsonc
{
  "meta": {
    "version": "2026-09-20", // build date (UTC)
    "variant": "lite", // "lite" | "full"
    "entries": 36485,
    "bytes": 10521344, // UTF-8 byte length of this file, meta included
    "importedAt": 1789873978034, // build timestamp, ms
    "source": "github.com/skywind3000/ECDICT + github.com/openlanguageprofiles/olp-en-cefrj",
  },
  "entries": [{ "w": "abandon", "p": "ә'bændәn", "t": ["vt. 放弃, 抛弃"], "frq": 3533 }],
}
```

`meta.bytes` is a fixed point: it counts the digits of its own value, so it
equals the file size a File picker reports and can be used to spot a truncated
download.

Entry fields (all optional except `w`, all omitted rather than empty):

| field  | meaning                               | comes from                                                           |
| ------ | ------------------------------------- | -------------------------------------------------------------------- |
| `w`    | headword, lowercased                  | ECDICT `word`                                                        |
| `l`    | lemma, only when it differs from `w`  | ECDICT `exchange` `0:` component, else the inverted `lemma.en.txt`   |
| `p`    | phonetic transcription                | ECDICT `phonetic`                                                    |
| `t`    | Chinese senses, one per line          | ECDICT `translation`                                                 |
| `d`    | English senses, one per line          | ECDICT `definition`                                                  |
| `pos`  | part-of-speech distribution           | ECDICT `pos`                                                         |
| `col`  | Collins stars, 1–5                    | ECDICT `collins`                                                     |
| `ox`   | `1` for Oxford core words             | ECDICT `oxford`, kept only when the column is `1`                    |
| `tags` | exam syllabi                          | ECDICT `tag`, mapped to the `ExamTag` union, unknown tags dropped    |
| `frq`  | contemporary corpus rank              | ECDICT `frq`                                                         |
| `bnc`  | BNC rank                              | ECDICT `bnc`                                                         |
| `x`    | inflections + lemma pointer, verbatim | ECDICT `exchange`                                                    |
| `cefr` | CEFR band                             | CEFR-J (A1–B2) and Octanove (C1–C2), joined by headword and by lemma |

Senses are split on the literal `\n` escapes ECDICT stores inside one CSV cell
(and on real newlines); blank lines are dropped. Ranks and Collins stars are
emitted only when they parse to a positive value — ECDICT writes `0` for "not in
this corpus", and a zero rank would read as the most frequent word alive to
`frequencyRank` in `tiers.ts`. `frq` leads `bnc` wherever the rank is compared.

`dist/learning-mode/manifest.json` describes the build:

```jsonc
{
  "version": "2026-09-20",
  "builtAt": "2026-09-20T12:32:58.034Z",
  "variants": [
    {
      "variant": "lite",
      "file": "dictionary-lite.json",
      "entries": 36485,
      "bytes": 10521344,
      "sha256": "…",
    },
  ],
  "sources": [{ "name": "ECDICT", "url": "…", "license": "MIT", "licenseUrl": "…" }],
}
```

The hashes cover the emitted files as they were written. `importedAt` and
`builtAt` move with the clock, so a rebuild always produces different bytes and
different hashes; the hashes describe one build, they are not a reproducibility
witness.

## What gets in

A row lands in a variant when its frequency rank is inside the window, or when
it carries an exam tag or a CEFR band:

| variant | rank window |
| ------- | ----------- |
| `lite`  | ≤ 20 000    |
| `full`  | ≤ 60 000    |

Exam tags and CEFR bands are kept at any rank (they are what the profile picker
selects on), so `lite` holds 36 485 rows of which 21 438 are inside its rank
window, and `full` holds 66 950 of which 56 992 are. Rows with neither a
translation nor a definition are dropped: a highlight whose card has no senses
to show is a bug, not a word. A lowercased headword can appear twice upstream
(`China`/`china`); the better-ranked row wins, which keeps the choice
deterministic, and while it also means a C1/C2 band on the losing row is lost,
no headword is lost by enabling the C1/C2 profile.

Entries are sorted by rank, then by headword, so an unranked row (`tags`/`cefr`
only) sits at the end and the artifact diffs cleanly between builds.

## Upstream sources

Resolved at build time of the checked-in artifacts:

| source                                | URL                                                                                                                   | licence                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ECDICT                                | `https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv`                                              | MIT ([LICENSE](https://github.com/skywind3000/ECDICT/blob/master/LICENSE))                                                                                                    |
| ECDICT lemma list                     | `https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt`                                            | free for research and educational use (per file header)                                                                                                                       |
| CEFR-J Vocabulary Profile 1.5         | `https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv`         | CEFR-J terms of use: free for research and commercial use with citation, © Tono Laboratory, TUFS ([terms](https://github.com/openlanguageprofiles/olp-en-cefrj#terms-of-use)) |
| Octanove Vocabulary Profile C1/C2 1.0 | `https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/octanove-vocabulary-profile-c1c2-1.0.csv` | CC BY-SA 4.0                                                                                                                                                                  |

The CEFR-J CSV name carries its version, so it is discovered instead of
hardcoded: the GitHub trees API for `openlanguageprofiles/olp-en-cefrj` is tried
first, then that repository's README (the API is rate limited per IP, which is
what happened for the checked-in build), and the file names known at build time
are the last resort. Discovery picks the newest `N.N` version of
`cefrj-vocabulary-profile-*.csv` and of `octanove-vocabulary-profile-c1c2-*.csv`.

`ecdict.mini.csv` is requested before `ecdict.csv`, but upstream ships a 4 KB
sample there (53 rows) rather than a dictionary, so anything under 1 MiB is
treated as missing and the 63 MB full dump is used. That dump is why the build
streams the CSV instead of reading it: records are split with a quote-aware scan
because ECDICT keeps commas and newlines inside quoted cells.

CEFR bands are joined by headword and by lemma (a page says `perceived`, the
band hangs off `perceive`), slash-separated headword variants such as
`a.m./A.M./am/AM` are expanded, and the easiest band wins when a headword is
listed under several parts of speech. C1/C2 come only from the Octanove profile.

The `l` field leans on ECDICT's `exchange` column first, which already lists an
inflected row's lemma; `lemma.en.txt` only fills the gaps. That file is a
frequency database, so a few closed-class forms resolve to unexpected bases
(`they` → `it`); `exchange` wins wherever it knows the row.

## Importing

The options page writes the payload to `chrome.storage.local` under
`learning-mode:dictionary-meta` and `learning-mode:dictionary-entries` (see
`src/utils/constants/learning-mode.ts`). The extension requests
`unlimitedStorage`, which matters: the checked-in build is 10.0 MB (`lite`) and
15.0 MB (`full`), 3.7 MB / 5.8 MB gzipped.
