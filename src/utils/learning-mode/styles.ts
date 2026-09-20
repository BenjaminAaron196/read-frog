import type { LearningDisplayConfig } from "@/types/config/learning-mode"

/**
 * Highlight colours are composed here rather than kept as CSS variables on
 * `:root`: the palette depends on the reader's intensity/wash choices, and a
 * highlight pseudo-element only accepts a small set of properties — writing the
 * final values means one stylesheet swap per settings change, with nothing to
 * keep in sync.
 */
export const LEARNING_MODE_STYLE_ID = "read-frog-learning-mode-styles"

/** The class the subtitle renderer puts on a marked word (see `subtitle-text.ts`). */
export const SUBTITLE_WORD_CLASS = "rf-subtitle-word"

/** Alpha values are expressed against these base hues in both schemes. */
const HUE_TIER1 = "99, 102, 241"
const HUE_TIER2 = "217, 119, 6"
const HUE_TIER3 = "225, 29, 72"
const HUE_SAVED = "5, 150, 105"
const HUE_HOVER = "37, 99, 235"
const HUE_KNOWN = "5, 150, 105"

function alpha(hue: string, value: number, intensity: number): string {
  return `rgba(${hue}, ${(value * intensity).toFixed(3)})`
}

function tierRule({
  name,
  hue,
  underlineStyle,
  underlineAlpha,
  thickness,
  washAlpha,
  display,
  dark,
}: {
  name: string
  hue: string
  underlineStyle: "dotted" | "solid" | "wavy"
  underlineAlpha: number
  thickness: number
  washAlpha: number
  display: LearningDisplayConfig
  dark: boolean
}): string {
  const decoration = display.underline
    ? `text-decoration: underline ${underlineStyle} ${alpha(hue, dark ? underlineAlpha + 0.15 : underlineAlpha, display.intensity)}; text-decoration-thickness: ${thickness}px;`
    : "text-decoration: none;"
  const background = display.wash
    ? `background-color: ${alpha(hue, dark ? washAlpha + 0.06 : washAlpha, display.intensity)};`
    : "background-color: transparent;"

  return `::highlight(${name}) { ${decoration} ${background} text-underline-offset: 0.18em; }`
}

const TIER_HUES: {
  tier: string
  hue: string
  underlineStyle: "dotted" | "solid"
  thickness: number
  washAlpha: number
}[] = [
  { tier: "tier1", hue: HUE_TIER1, underlineStyle: "dotted", thickness: 1.5, washAlpha: 0 },
  { tier: "tier2", hue: HUE_TIER2, underlineStyle: "solid", thickness: 1.5, washAlpha: 0.12 },
  { tier: "tier3", hue: HUE_TIER3, underlineStyle: "solid", thickness: 2, washAlpha: 0.16 },
]

/**
 * The same ramp as the page marks, for the subtitle renderer.
 *
 * The page's rules are `::highlight()` pseudo-elements, which cannot paint inside
 * a shadow root; the subtitles are rendered by Read Frog inside one, so the marks
 * there are real spans. Same hues, same shapes, one palette behind both.
 */
export function buildSubtitleMarkCss(display: LearningDisplayConfig): string {
  const rules: string[] = []
  for (const { tier, hue, underlineStyle, thickness, washAlpha } of TIER_HUES) {
    const decoration = display.underline
      ? `text-decoration: underline ${underlineStyle} ${alpha(hue, 0.9, display.intensity)}; text-decoration-thickness: ${thickness}px; text-underline-offset: 0.18em;`
      : "text-decoration: none;"
    const background = display.wash
      ? `background-color: ${alpha(hue, washAlpha, display.intensity)};`
      : "background-color: transparent;"
    rules.push(`.${SUBTITLE_WORD_CLASS}[data-tier="${tier}"] { ${decoration} ${background} }`)
  }
  return rules.join("\n")
}

/**
 * The page-injected stylesheet for the marks. The three tiers read as a ramp —
 * a quiet dotted underline, then a solid one with a wash, then the loudest wash
 * — so a reader can tell "worth a look" from "you will not know this" without a
 * legend.
 */
export function buildLearningModeCss(display: LearningDisplayConfig): string {
  const light = [
    tierRule({
      name: "rf-word-tier1",
      hue: HUE_TIER1,
      underlineStyle: "dotted",
      underlineAlpha: 0.85,
      thickness: 1.5,
      washAlpha: 0,
      display,
      dark: false,
    }),
    tierRule({
      name: "rf-word-tier2",
      hue: HUE_TIER2,
      underlineStyle: "solid",
      underlineAlpha: 0.9,
      thickness: 1.5,
      washAlpha: 0.12,
      display,
      dark: false,
    }),
    tierRule({
      name: "rf-word-tier3",
      hue: HUE_TIER3,
      underlineStyle: "solid",
      underlineAlpha: 0.95,
      thickness: 2,
      washAlpha: 0.16,
      display,
      dark: false,
    }),
    tierRule({
      name: "rf-word-saved",
      hue: HUE_SAVED,
      underlineStyle: "wavy",
      underlineAlpha: 0.9,
      thickness: 1.5,
      washAlpha: 0.12,
      display,
      dark: false,
    }),
  ].join("\n")

  const dark = [
    tierRule({
      name: "rf-word-tier1",
      hue: "165, 180, 252",
      underlineStyle: "dotted",
      underlineAlpha: 0.75,
      thickness: 1.5,
      washAlpha: 0,
      display,
      dark: true,
    }),
    tierRule({
      name: "rf-word-tier2",
      hue: "252, 211, 77",
      underlineStyle: "solid",
      underlineAlpha: 0.85,
      thickness: 1.5,
      washAlpha: 0.14,
      display,
      dark: true,
    }),
    tierRule({
      name: "rf-word-tier3",
      hue: "253, 164, 175",
      underlineStyle: "solid",
      underlineAlpha: 0.9,
      thickness: 2,
      washAlpha: 0.18,
      display,
      dark: true,
    }),
    tierRule({
      name: "rf-word-saved",
      hue: "110, 231, 183",
      underlineStyle: "wavy",
      underlineAlpha: 0.85,
      thickness: 1.5,
      washAlpha: 0.14,
      display,
      dark: true,
    }),
  ].join("\n")

  const transient = `
::highlight(rf-word-hover) {
  background-color: ${alpha(HUE_HOVER, 0.24, display.intensity)};
}
::highlight(rf-word-known) {
  background-color: ${alpha(HUE_KNOWN, 0.3, display.intensity)};
}
`

  return `
${light}

@media (prefers-color-scheme: dark) {
${dark}
}

${transient}
`
}

/**
 * Injects the stylesheet into the page. A plain `<style>` element rather than an
 * adopted sheet: the rules are rewritten whenever the palette settings change,
 * and text replacement on one element is cheaper than juggling sheets.
 */
export function applyLearningModeCss(css: string): void {
  const existing = document.getElementById(LEARNING_MODE_STYLE_ID)
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }

  const styleElement = document.createElement("style")
  styleElement.id = LEARNING_MODE_STYLE_ID
  styleElement.textContent = css
  document.head.appendChild(styleElement)
}

export function removeLearningModeCss(): void {
  document.getElementById(LEARNING_MODE_STYLE_ID)?.remove()
}
