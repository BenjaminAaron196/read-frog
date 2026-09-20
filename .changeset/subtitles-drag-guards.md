---
"@readfrog/extension": patch
---

fix(subtitles): stop the subtitle box from getting stuck where it cannot be dragged

Two ways the box could stop answering the pointer:

- The drag math divides by the video's height. A container that is momentarily
  collapsed (a fullscreen transition, a hidden player) makes that zero, the
  quotient is `NaN`, and `top: NaN%` is invalid CSS - the box then ignores every
  later drag and looks stuck wherever it was.
- The drag range did not reserve the grip's height, so the subtitles could be
  parked with their handle outside the player, leaving nothing to grab.

The percent is now clamped to a finite range on every write and on the way into
the style, the range keeps room for the grip, a stored position that no longer
fits is corrected on the way in, and degenerate geometry leaves the position
alone instead of corrupting it.
