---
"@readfrog/extension": patch
---

fix(learning-mode): keep the word card on the word under the pointer

The card was rebuilt from the caret on every pointer move, so it followed the
caret's noise instead of the reader: it flipped between neighbouring words at
their edges, stayed put when the pointer moved to another copy of the same word,
refreshed with a new word at the old position, and vanished the moment the
pointer travelled from the word to the card's own buttons.

It also landed on the word it was describing when the word sat near the bottom
of the window, and it fought with the page's own link previews for the same
pixels. The card now picks the side of the word that is free (beside it, then
below, then above), is placed from its measured height once the answer for the
sentence and the AI half have landed, and steps aside from Wikipedia's previews.
