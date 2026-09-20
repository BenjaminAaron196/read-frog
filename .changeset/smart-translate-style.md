---
"@readfrog/extension": minor
---

feat(translation): smart style selection with bundled genre prompts

The AI translation style picker gains a **Smart** option and eight genre styles:
news and current affairs, gaming communities, technical docs, academic papers,
social posts and forums, shopping pages, fiction, and spoken content (subtitles).
Each style states what its readers expect and what must survive untouched -
reportorial register and exact figures for news, in-game terms and quoted
mechanics for gaming, verbatim identifiers for docs, hedges and notation for
papers, voice and idiom for social posts, specifications and claims for shops,
rhythm and dialogue for fiction, readable-at-speaking-speed clauses for speech.

Smart reads the page's title, description and the passage itself and applies the
style they name, staying on the default prompt when nothing does. The decision is
taken inside the prompt builder, before the prompt becomes the translation cache
key, so the side that hashes and the side that translates always agree; an explicit
style choice bypasses the classification, and a reader who wants their own
version of a style gives their prompt a different id and selects it.
