---
"@readfrog/extension": minor
---

feat(subtitles): carry the learning mode's marks into the subtitles

Words above the reader's level are now marked in the video subtitles and in the
transcript the sidebar shows, and hovering one opens the same card the page
uses: phonetic, senses, frequency, the sentence it was read in, the contextual
explanation, and the three actions. A word marked as known or ignored stops
being marked at once.

The subtitle line is rendered by Read Frog inside a shadow root, where the Custom
Highlight API cannot paint, so its marks are spans styled from the same palette;
the card, the actions and the AI request are the page's own, shared through one
module instead of a second implementation.
