import { TRANSLATE_STYLE_IDS } from "@/utils/constants/translate-style-prompts"

/**
 * Asking a model what kind of page this is.
 *
 * The styles are chosen by the model rather than by keyword rules: a release
 * note, a match report and a forum thread share words but want different
 * English, and the URL says more than the text does ("/patch-notes", "/wiki",
 * "/blog"). The answer is a single id, and anything the model says that is not
 * one of them is read as "no style", which leaves the default prompt in place.
 */
export const STYLE_CLASSIFY_SYSTEM_PROMPT = `# Role: Page Genre Classifier
You classify a web page so a translator can pick the right translation style for it.

## The styles
${TRANSLATE_STYLE_IDS.map((id) => `- ${id}`).join("\n")}
- default: everything else, including pages that do not make their genre clear

## Rules
1. Use the URL, the title, and the description together. A path or a host often names the genre when the title does not.
2. Answer with exactly one word: one of the ids above.
3. Answer \`default\` when the evidence does not name a genre. A wrong style is worse than no style: it changes how every paragraph is translated.
4. Never explain, never add punctuation, never answer with anything but the id.

## Examples
URL: https://www.reuters.com/world/middle-east/article-2026-09-19/
Title: Saudi civil defence sends all clear after danger warning
Answer: news

URL: https://store.steampowered.com/news/app/570/view/1234
Title: Patch 2.4 - gameplay balance
Answer: gaming

URL: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
Title: Using the Fetch API
Answer: tech-docs

URL: https://example.com/
Title: Example Domain
Answer: default`

export interface StyleClassifyInput {
  url: string
  title?: string | null
  description?: string | null
}

/**
 * Whether the page has told us enough to be classified.
 *
 * A page served before it hydrates reports its own host as the title
 * ("reuters.com") and no description; asking the model then earns a correct
 * `default` that, cached per URL, would keep the page on the default prompt for
 * good. Such an answer is not an answer: the caller takes it as "not yet".
 */
export function hasClassifiableMetadata(input: StyleClassifyInput): boolean {
  const title = input.title?.trim() ?? ""
  const description = input.description?.trim() ?? ""

  // A title that is the site's own host is the shell page's signature, however
  // long the hostname happens to be.
  try {
    const host = new URL(input.url).hostname.replace(/^www\./, "").toLowerCase()
    if (title.length > 0 && host.startsWith(title.toLowerCase())) return false
  } catch {
    // An unparsable URL is no reason to skip the call.
  }

  if (title.length >= 8) return true
  return description.length >= 16
}

export function getStyleClassifyPrompt(input: StyleClassifyInput): string {
  return `URL: ${input.url}
Title: ${input.title?.trim() || "(none)"}
Description: ${input.description?.trim() || "(none)"}

Answer with one id.`
}

/** The style the model named, or null when it named nothing we ship. */
export function parseStyleVerdict(answer: string): string | null {
  const cleaned = answer
    .trim()
    .toLowerCase()
    .replace(/[`"'.\s]+/g, "")
  const match = TRANSLATE_STYLE_IDS.find((id) => cleaned === id || cleaned === id.replace("-", ""))
  return match ?? null
}
