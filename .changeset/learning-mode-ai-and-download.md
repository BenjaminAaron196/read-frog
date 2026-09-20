---
"@read-frog/extension": minor
---

feat(learning-mode): explain a marked word in the sentence you found it in

Hovering a marked word now also shows what it means _here_: the card asks the
page-translation model for that one sentence's sense and for the other senses
worth knowing, and caches the answer per word and sentence, so the same word in
the same sentence is free the second time. The number of words one page may ask
about is capped in the settings, and the whole block can be switched off.

The dictionary no longer has to be downloaded by hand: the settings page lists
download sources, fetches the manifest, streams the variant with progress, and
verifies the size and sha256 before writing anything into the extension — a bad
download leaves the previous dictionary in place. The local-file import stays as
the fallback path.

Marking is now lazy: only the blocks near the reader are judged, and the rest
arrive as they scroll. A vocabulary-dense article that used to build every mark
up front now starts with a fraction of them, and a per-page cap still bounds the
worst case.
