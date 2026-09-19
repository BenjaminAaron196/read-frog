---
"@read-frog/extension": patch
---

fix(translation): stop page translation from translating Read Frog's own panels

The walk descends into open shadow roots to reach shadow-DOM sites, which also
took it into the extension's own shadow hosts. With page translation and video
subtitles both on, the subtitles sidebar's labels - "Learn", the transcript and
summary tabs - were translated along with the page and came back with a
translated copy injected beside them. Extension-owned shadow hosts are now
walk-blocked like the rest of the extension's UI.
