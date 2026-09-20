import type { TranslateStyleId } from "@/utils/constants/translate-style-prompts"

/**
 * Which translation style a page is, decided from what every translation path
 * already has.
 *
 * The decision has to be deterministic and identical wherever it is taken: the
 * finished prompt is the translation cache key, so the content script that hashes
 * a paragraph and the background that translates it must classify it the same
 * way. That rules out anything the background cannot see - the page URL is not in
 * `WebPagePromptContext` - and rules in the signals that travel with the request:
 * the page's title, its description, and the passage itself.
 *
 * The signals are cheap and deliberately conservative: a style is chosen only
 * when the evidence names it, and everything else stays on the default prompt.
 */

/** The stored id that asks for a style to be chosen rather than named. */
export const SMART_TRANSLATE_PROMPT_ID = "smart"

export interface StyleClassificationInput {
  title?: string | null
  description?: string | null
  /** The passage being translated, when the caller has it. */
  input?: string | null
}

interface StyleRule {
  id: TranslateStyleId
  /** Any of these, in the title or description, names the genre. */
  titleSignals: RegExp
  /** Any of these in the passage names the genre; weighted lower than the title. */
  bodySignals: RegExp
  /** How many body signals are needed before the rule stands on its own. */
  bodyThreshold: number
}

const RULES: StyleRule[] = [
  {
    id: "academic",
    titleSignals:
      /arxiv|preprint|abstract|paper|journal|proceedings|论文|文献|期刊|研究|学报|preprint|doi:/i,
    bodySignals:
      /(abstract|introduction|methodology|we propose|et al\.|figure \d|table \d|参考文献|摘要|引言)/gi,
    bodyThreshold: 2,
  },
  {
    id: "tech-docs",
    titleSignals:
      /docs?|documentation|api|reference|release notes?|changelog|sdk|developer|手册|文档|接口|开发|版本说明/i,
    bodySignals:
      /(function|parameter|returns|install|npm |pip |git |```|\bAPI\b|参数|返回值|安装)/g,
    bodyThreshold: 3,
  },
  {
    id: "gaming",
    titleSignals:
      /patch notes?|gameplay|boss|raid|dungeon|esports|steam|英雄|攻略|开黑|版本更新|游戏|副本|赛季/i,
    bodySignals: /(\bnerf|\bbuff|\bDPS\b|\bAoE\b|\bmeta\b|\bpatch \d|装备|技能|副本|打野|上分)/g,
    bodyThreshold: 2,
  },
  {
    id: "news",
    titleSignals:
      /reuters|associated press|bbc|breaking|news|report|记者|报道|新闻|快讯|通讯社|时政/i,
    bodySignals: /(said on|told reporters|according to|Reuters|新华社|据.*报道|记者.*获悉)/g,
    bodyThreshold: 2,
  },
  {
    id: "ecommerce",
    titleSignals: /buy|shop|price|deal|product|cart|checkout|购买|商品|价格|优惠|旗舰店|下单/i,
    bodySignals: /(\$\d|\d+% off|free shipping|in stock|add to cart|规格|库存|包邮|优惠券|型号)/g,
    bodyThreshold: 2,
  },
  {
    id: "fiction",
    titleSignals: /chapter|novel|fiction|webnovel|连载|小说|第.{1,3}章|故事/i,
    bodySignals: /(“|”|said the|whispered|他.*说道|她.*笑道)/g,
    bodyThreshold: 3,
  },
  {
    id: "social",
    titleSignals: /thread|forum|reddit|tweet|comments?|discussion|帖子|论坛|评论|讨论|超话/i,
    bodySignals: /(\bOP\b|\bIMO\b|\bTL;DR\b|lol|楼主|沙发|转发|点赞|回复)/g,
    bodyThreshold: 2,
  },
  {
    id: "spoken",
    titleSignals: /podcast|interview|transcript|episode|字幕|访谈|播客|口播|演讲/i,
    bodySignals: /(\bum\b|\buh\b|you know|I mean|kind of|那个|就是说|然后呢)/g,
    bodyThreshold: 3,
  },
]

function countMatches(pattern: RegExp, text: string): number {
  // A fresh lastIndex per call: the patterns carry /g and are module-level.
  const scanner = new RegExp(pattern.source, pattern.flags)
  let count = 0
  while (scanner.exec(text) !== null && count < 16) count += 1
  return count
}

/**
 * The style a request belongs to, or null when nothing names one: a page that
 * does not say what it is keeps the default prompt rather than being guessed at.
 */
export function classifyTranslateStyle(input: StyleClassificationInput): TranslateStyleId | null {
  const title = `${input.title ?? ""}\n${input.description ?? ""}`
  const body = input.input ?? ""

  for (const rule of RULES) {
    if (rule.titleSignals.test(title)) return rule.id
  }
  for (const rule of RULES) {
    if (countMatches(rule.bodySignals, body) >= rule.bodyThreshold) return rule.id
  }
  return null
}

/**
 * The prompt id to build from: the reader's own choice, unless they asked for a
 * style to be chosen - in which case the classification decides, and a page
 * nothing names stays on `default`.
 */
export function resolvePromptIdForRequest(
  requestedId: string,
  input: StyleClassificationInput,
  defaultId: string,
): string {
  if (requestedId !== SMART_TRANSLATE_PROMPT_ID) return requestedId
  return classifyTranslateStyle(input) ?? defaultId
}
