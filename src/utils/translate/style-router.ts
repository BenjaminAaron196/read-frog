import { styleVerdictFor } from "@/utils/translate/style-verdict"

/**
 * Which translation style a request belongs to.
 *
 * The decision is a model's, taken once per URL by the background and shared
 * (see `style-verdict.ts`): keyword rules guessed from a title cannot tell a
 * release note from a forum post, and the URL - which the classifier sees - says
 * more than the text does. Nothing here asks the model again, so the side that
 * hashes a paragraph and the side that translates it build the same prompt.
 */

/** The stored id that asks for a style to be chosen rather than named. */
export const SMART_TRANSLATE_PROMPT_ID = "smart"

export interface StyleRoutingInput {
  url?: string | null
  title?: string | null
  description?: string | null
}

/**
 * The prompt id to build from: the reader's own choice, unless they asked for a
 * style to be chosen - in which case the page's verdict decides, and a page whose
 * verdict is unknown or empty stays on the default prompt.
 */
export function resolvePromptIdForRequest(
  requestedId: string,
  input: StyleRoutingInput,
  defaultId: string,
): string {
  if (requestedId !== SMART_TRANSLATE_PROMPT_ID) return requestedId
  const verdict = input.url ? styleVerdictFor(input.url) : undefined
  return verdict ?? defaultId
}
