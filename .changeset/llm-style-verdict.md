---
"@readfrog/extension": minor
---

feat(translation): choose the smart style with the model, once per page

The "smart" style is now decided by the configured model rather than by keyword
rules: the content script sends the page's URL, title and description to the
background, which asks the model for one of the bundled genre ids (or `default`)
and caches the answer per URL.

The answer has to be shared, not recomputed: the finished prompt is the
translation cache key, and the side that hashes a paragraph is not the side that
translates it. Both read the same verdict - the background from its own cache,
the content script from the message it fetched before building anything - so one
page has one prompt.

The popup shows what smart picked (`智能切换(时事新闻)`), and says so while the
verdict is still being taken.
