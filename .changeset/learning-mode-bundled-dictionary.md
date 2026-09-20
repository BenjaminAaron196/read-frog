---
"@readfrog/extension": minor
---

feat(learning-mode): ship the dictionary with the extension

Learning mode marks nothing without a dictionary, and a fresh install had none:
the download source list is empty on purpose and the artifact has to be built or
mirrored by hand, so the feature looked broken until a reader found the settings
page.

The lite build now travels with the extension. The background adopts it the
first time it starts without a dictionary - an imported or downloaded one always
wins - and the "Choose file" button opens the picker again: a `<label for>`
nested inside a button is not activated, which is what made it look dead.
