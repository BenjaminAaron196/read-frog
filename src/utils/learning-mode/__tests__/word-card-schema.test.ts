import { describe, expect, it } from "vitest"
import { parseWordCardAiResult } from "../word-card-schema"

describe("parseWordCardAiResult", () => {
  it("reads the expected object", () => {
    const result = parseWordCardAiResult(
      '{"contextual":"统计学习","senses":[{"pos":"n.","meaning":"统计学"}],"note":"常用" }',
    )
    expect(result).toEqual({
      contextual: "统计学习",
      senses: [{ pos: "n.", meaning: "统计学" }],
      note: "常用",
    })
  })

  it("takes the object out of surrounding prose or a code fence", () => {
    const fenced = 'Here you go:\n```json\n{"contextual":"本句指统计学习"}\n```\nHope that helps.'
    expect(parseWordCardAiResult(fenced)?.contextual).toBe("本句指统计学习")
  })

  it("keeps a result that omits the optional fields", () => {
    const result = parseWordCardAiResult('{"contextual":"语境义"}')
    expect(result?.contextual).toBe("语境义")
    expect(result?.senses).toEqual([])
  })

  it("gives up instead of inventing a result", () => {
    expect(parseWordCardAiResult("I cannot help with that.")).toBe(null)
    expect(parseWordCardAiResult("")).toBe(null)
    // A shape without the one required field is not a partial success.
    expect(parseWordCardAiResult('{"senses":[{"meaning":"x"}]}')).toBe(null)
  })
})
