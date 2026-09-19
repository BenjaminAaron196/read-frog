---
"@read-frog/extension": minor
---

feat: context-aware selection translation, and a word book that syncs to Notion

Selection translation now reads the paragraph the selection sits in and the page metadata, and the
default prompt spells out how to use them: resolve pronouns and elided subjects, pick the sense the
passage uses, keep terminology consistent, translate idioms as idioms, and never mention the
context in the output. The `{{paragraphs}}` token is available to custom prompts too.

Words saved from the dictionary popover - or from the note suggestions under a selection
translation - land in a local word book immediately, and sync to a Notion database once an
integration token and a field mapping are configured. One word keeps one Notion page: an entry
already in the database is linked instead of duplicated.

The note-suggestion prompt was rewritten to carry the rules weaker models do not infer on their
own: the exact field names and their order, what is worth saving (single words and phrases alike)
and what never is, which language each field is written in, and a self-check before answering.
