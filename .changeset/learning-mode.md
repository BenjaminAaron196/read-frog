---
"@read-frog/extension": minor
---

feat(learning-mode): a reading mode that marks the words above your level

Turn it on, import a dictionary, and the words that sit above your current level
are underlined where they appear: three tiers, from a quiet dotted line to a
warm wash for the words you will not know. Hovering one opens a card with the
phonetic, the senses, the sentence it came from, its CEFR band, exam tags,
frequency and Collins stars - and three actions: save it to the word book, mark
it as known, or ignore it.

The marks are CSS custom highlights, not elements: nothing is inserted into the
page, so the site's own rendering, the page translation and React's
reconciliation are untouched.

Difficulty comes from a downloaded dictionary (ECDICT with CEFR-J and Octanove
bands): pick one profile - an exam (CET-4/6, 考研, TOEFL, IELTS, GRE), a CEFR
level, or a vocabulary size - and the tier rules read the same way everywhere.
Words you marked as known or ignored are never marked again, and marking one
carries its whole inflection family.
