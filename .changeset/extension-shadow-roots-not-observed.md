---
"@read-frog/extension": patch
---

fix(translation): stop observing inside Read Frog's own shadow hosts

Blocking the walk at an extension shadow host is not enough: the page
translation also observes shadow roots directly (to follow shadow-DOM
sites), and a walk that starts from a container inside the subtitles panel
never sees the host-level check. The panel's own re-renders therefore fed
the translation pipeline, which labelled and translated its labels - and
left the player subtitles switched off when the panel's React tree was
disturbed mid-translation.
