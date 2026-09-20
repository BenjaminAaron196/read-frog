import { z } from "zod"

/**
 * The word card's AI answer. Parsed rather than trusted: a model that wraps its
 * JSON in prose, or returns four senses, should degrade to something the card
 * can still show instead of failing the request.
 */
export const wordCardSenseSchema = z.object({
  pos: z.string().max(24).catch(""),
  meaning: z.string().max(60),
})

export const wordCardAiResultSchema = z.object({
  contextual: z.string().max(120),
  senses: z.array(wordCardSenseSchema).max(4).catch([]),
  note: z.string().max(80).optional().catch(undefined),
})

export type WordCardAiResult = z.infer<typeof wordCardAiResultSchema>

/** Trailing prose or code fences around the object are common; take the object. */
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "")
    : trimmed

  const start = withoutFence.indexOf("{")
  const end = withoutFence.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined

  try {
    return JSON.parse(withoutFence.slice(start, end + 1))
  } catch {
    return undefined
  }
}

export function parseWordCardAiResult(text: string): WordCardAiResult | null {
  const parsed = wordCardAiResultSchema.safeParse(extractJsonObject(text))
  return parsed.success ? parsed.data : null
}
