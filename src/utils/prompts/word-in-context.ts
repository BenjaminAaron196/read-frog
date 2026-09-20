import type { LangCodeISO6393, LangLevel } from "@read-frog/definitions"
import { LANG_CODE_TO_EN_NAME } from "@read-frog/definitions"

/**
 * One word, one sentence, one question: what does it mean *here*, and what are
 * the other senses a reader should know about? Deliberately narrow — the local
 * dictionary already carries the headword's general senses, so the model is
 * only asked for what the dictionary cannot answer.
 */
export function getWordInContextPrompt({
  word,
  sentence,
  pageTitle,
  sourceLang,
  targetLang,
  langLevel,
}: {
  word: string
  sentence: string
  pageTitle?: string
  sourceLang: LangCodeISO6393
  targetLang: LangCodeISO6393
  langLevel: LangLevel
}) {
  const sourceLangName = LANG_CODE_TO_EN_NAME[sourceLang]
  const targetLangName = LANG_CODE_TO_EN_NAME[targetLang]

  const systemPrompt = `You explain one ${sourceLangName} word to a reader whose language is ${targetLangName} and whose level is ${langLevel}.

Reply with minified JSON only, in this shape:
{"contextual":"<what the word means in the given sentence, ${targetLangName}, at most 20 characters>","senses":[{"pos":"<n.|v.|adj.|adv.|prep.|phrase>","meaning":"<another common sense, ${targetLangName}, at most 14 characters>"}],"note":"<optional usage note, at most 16 characters, omit when there is nothing useful to add>"}

Rules:
1. The sentence decides the contextual meaning; never give the word's most common sense when the sentence shows another one.
2. At most three senses, most useful first; never repeat the contextual meaning.
3. Prefer senses the reader at this level is likely to meet again.
4. No text outside the JSON. No markdown.`

  const prompt = [`word: ${word}`, `sentence: ${sentence}`, pageTitle ? `page: ${pageTitle}` : ""]
    .filter(Boolean)
    .join("\n")

  return { systemPrompt, prompt }
}
