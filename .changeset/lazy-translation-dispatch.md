---
"@read-frog/extension": patch
---

perf(translation): pace page translation instead of translating everything at once

Opening a translation on a long article used to fire every paragraph the
intersection observer reported: measured on a wiki-scale page, 49 requests in
the first 20 seconds, all inside one 3.7-second burst. Paragraphs are now
queued and dispatched during idle slices, one batch per slice, only once they
are within reach of the viewport, and never while the tab is hidden — the same
page now spends 13 requests over the whole 20 seconds and still fills in as the
reader scrolls (17 → 36 → 48 translated blocks across a scroll pass). What a
paragraph gets does not change; only when it is asked for.
