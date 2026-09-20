import type { TranslatePromptObj } from "@/types/config/translate"
import {
  BUILT_IN_PAGE_TRANSLATE_PROMPTS,
  BUILT_IN_SUBTITLE_TRANSLATE_PROMPTS,
  DEFAULT_TRANSLATE_PROMPT_ID,
  PRECISION_REWRITE_TRANSLATE_PROMPT_ID,
} from "@/utils/constants/prompt"
import {
  TRANSLATE_STYLE_IDS,
  TRANSLATE_STYLE_PROMPTS,
} from "@/utils/constants/translate-style-prompts"
import { i18n } from "@/utils/i18n"
import { SMART_TRANSLATE_PROMPT_ID } from "@/utils/translate/style-router"

interface BuiltInPromptDefinition {
  id: string
  systemPrompt: string
  prompt: string
}

export interface BuiltInPrompt extends TranslatePromptObj {
  description: string
}

function getBuiltInPromptCopy(id: string): Pick<BuiltInPrompt, "name" | "description"> {
  switch (id) {
    case DEFAULT_TRANSLATE_PROMPT_ID:
      return {
        name: i18n.t("options.translation.personalizedPrompts.default"),
        description: i18n.t(
          "options.translation.personalizedPrompts.builtInPrompts.default.description",
        ),
      }
    case PRECISION_REWRITE_TRANSLATE_PROMPT_ID:
      return {
        name: i18n.t(
          "options.translation.personalizedPrompts.builtInPrompts.precisionRewrite.name",
        ),
        description: i18n.t(
          "options.translation.personalizedPrompts.builtInPrompts.precisionRewrite.description",
        ),
      }
    case SMART_TRANSLATE_PROMPT_ID:
      return {
        name: i18n.t("options.translation.personalizedPrompts.builtInPrompts.smart.name"),
        description: i18n.t(
          "options.translation.personalizedPrompts.builtInPrompts.smart.description",
        ),
      }
    default: {
      // The genre styles: the picker names each one, and the router picks one of
      // them when the reader asked for "smart" instead.
      const copy = STYLE_COPY[id as keyof typeof STYLE_COPY]
      if (!copy) throw new Error(`Unknown built-in prompt id: ${id}`)
      return copy()
    }
  }
}

/** One entry per style, with literal keys so the i18n types stay checked. */
const STYLE_COPY = {
  news: () => ({
    name: i18n.t("options.translation.personalizedPrompts.builtInPrompts.news.name"),
    description: i18n.t("options.translation.personalizedPrompts.builtInPrompts.news.description"),
  }),
  gaming: () => ({
    name: i18n.t("options.translation.personalizedPrompts.builtInPrompts.gaming.name"),
    description: i18n.t(
      "options.translation.personalizedPrompts.builtInPrompts.gaming.description",
    ),
  }),
  "tech-docs": () => ({
    name: i18n.t("options.translation.personalizedPrompts.builtInPrompts.techDocs.name"),
    description: i18n.t(
      "options.translation.personalizedPrompts.builtInPrompts.techDocs.description",
    ),
  }),
  academic: () => ({
    name: i18n.t("options.translation.personalizedPrompts.builtInPrompts.academic.name"),
    description: i18n.t(
      "options.translation.personalizedPrompts.builtInPrompts.academic.description",
    ),
  }),
  social: () => ({
    name: i18n.t("options.translation.personalizedPrompts.builtInPrompts.social.name"),
    description: i18n.t(
      "options.translation.personalizedPrompts.builtInPrompts.social.description",
    ),
  }),
  ecommerce: () => ({
    name: i18n.t("options.translation.personalizedPrompts.builtInPrompts.ecommerce.name"),
    description: i18n.t(
      "options.translation.personalizedPrompts.builtInPrompts.ecommerce.description",
    ),
  }),
  fiction: () => ({
    name: i18n.t("options.translation.personalizedPrompts.builtInPrompts.fiction.name"),
    description: i18n.t(
      "options.translation.personalizedPrompts.builtInPrompts.fiction.description",
    ),
  }),
  spoken: () => ({
    name: i18n.t("options.translation.personalizedPrompts.builtInPrompts.spoken.name"),
    description: i18n.t(
      "options.translation.personalizedPrompts.builtInPrompts.spoken.description",
    ),
  }),
}

/** "Smart" and the genre styles, in the order the picker shows them. */
function getStyleEntries(): BuiltInPromptDefinition[] {
  return [
    { id: SMART_TRANSLATE_PROMPT_ID, systemPrompt: "", prompt: "" },
    ...TRANSLATE_STYLE_IDS.map((id) => TRANSLATE_STYLE_PROMPTS[id]),
  ]
}

function localizeBuiltInPrompts(
  registry: Record<string, BuiltInPromptDefinition>,
): BuiltInPrompt[] {
  return Object.values(registry).map((prompt) => ({
    ...prompt,
    ...getBuiltInPromptCopy(prompt.id),
  }))
}

export function getBuiltInPageTranslatePrompts(): BuiltInPrompt[] {
  return localizeBuiltInPrompts(BUILT_IN_PAGE_TRANSLATE_PROMPTS)
}

export function getBuiltInSubtitleTranslatePrompts(): BuiltInPrompt[] {
  return localizeBuiltInPrompts(BUILT_IN_SUBTITLE_TRANSLATE_PROMPTS)
}

/** Page prompts plus the genre styles, which the page builder can resolve. */
export function getPageTranslatePromptChoices(): BuiltInPrompt[] {
  return [
    ...getBuiltInPageTranslatePrompts(),
    ...localizeBuiltInPrompts(
      Object.fromEntries(getStyleEntries().map((entry) => [entry.id, entry])),
    ),
  ]
}

/** Subtitle prompts plus the genre styles, which the subtitle builder resolves. */
export function getSubtitleTranslatePromptChoices(): BuiltInPrompt[] {
  return [
    ...getBuiltInSubtitleTranslatePrompts(),
    ...localizeBuiltInPrompts(
      Object.fromEntries(getStyleEntries().map((entry) => [entry.id, entry])),
    ),
  ]
}

export function getPageTranslatePromptSelectItems(patterns: TranslatePromptObj[]) {
  return [
    ...getPageTranslatePromptChoices().map(({ id, name }) => ({ value: id, label: name })),
    ...patterns.map(({ id, name }) => ({ value: id, label: name })),
  ]
}
