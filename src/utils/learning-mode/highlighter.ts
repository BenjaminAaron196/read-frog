import type { LearningDictionaryEntry, LearningMatch, LearningTier } from "./types"

/**
 * Marks live as CSS custom highlights: a `Range` per marked word, registered
 * under one name per tier. Nothing is inserted into the page, so the marks
 * cannot disturb the site's own rendering, the page translation's wrappers, or
 * React's reconciliation.
 */
export interface MarkedOccurrence {
  range: Range
  tier: LearningTier
  entry: LearningDictionaryEntry
  surface: string
  sentence: string
}

const TIER_HIGHLIGHT_NAME: Record<LearningTier, string> = {
  tier1: "rf-word-tier1",
  tier2: "rf-word-tier2",
  tier3: "rf-word-tier3",
}

/** Words the reader already saved get their own colour instead of the tier's. */
const SAVED_HIGHLIGHT_NAME = "rf-word-saved"
const HOVER_HIGHLIGHT_NAME = "rf-word-hover"
const KNOWN_HIGHLIGHT_NAME = "rf-word-known"

interface OccurrenceSlot {
  start: number
  end: number
  occurrence: MarkedOccurrence
}

/**
 * Owns every mark on the page: the ranges, the index used for hit-testing, and
 * the `HighlightRegistry` entries. The registry is only touched on `commit()`
 * so a scan can add hundreds of ranges without repainting per mark.
 */
export class LearningHighlighter {
  private occurrences: MarkedOccurrence[] = []

  private byTextNode = new Map<Text, OccurrenceSlot[]>()

  private savedWords = new Set<string>()

  private hovered: MarkedOccurrence | null = null

  private knownFlash: MarkedOccurrence | null = null

  readonly supported: boolean =
    typeof CSS !== "undefined" && typeof CSS.highlights === "object" && CSS.highlights !== null

  get count(): number {
    return this.occurrences.length
  }

  get isFull(): boolean {
    return false
  }

  get occurrencesSnapshot(): readonly MarkedOccurrence[] {
    return this.occurrences
  }

  add(range: Range, match: LearningMatch, sentence: string): void {
    const occurrence: MarkedOccurrence = {
      range,
      tier: match.tier,
      entry: match.entry,
      surface: match.surface,
      sentence,
    }
    this.occurrences.push(occurrence)

    const textNode = range.startContainer
    if (textNode.nodeType === Node.TEXT_NODE) {
      const typed = textNode as Text
      const slots = this.byTextNode.get(typed)
      const slot: OccurrenceSlot = { start: range.startOffset, end: range.endOffset, occurrence }
      if (slots) {
        slots.push(slot)
      } else {
        this.byTextNode.set(typed, [slot])
      }
    }
  }

  /** Words already in the word book are shown in their own colour. */
  setSavedWords(words: ReadonlySet<string>): void {
    this.savedWords = new Set(words)
  }

  commit(): void {
    if (!this.supported) return

    const byTier: Record<LearningTier, Range[]> = { tier1: [], tier2: [], tier3: [] }
    const saved: Range[] = []

    for (const occurrence of this.occurrences) {
      if (!occurrence.range.startContainer.isConnected) continue
      if (this.savedWords.has(occurrence.entry.w)) {
        saved.push(occurrence.range)
        continue
      }
      byTier[occurrence.tier].push(occurrence.range)
    }

    for (const tier of Object.keys(byTier) as LearningTier[]) {
      const ranges = byTier[tier]
      if (ranges.length === 0) {
        CSS.highlights.delete(TIER_HIGHLIGHT_NAME[tier])
        continue
      }
      CSS.highlights.set(TIER_HIGHLIGHT_NAME[tier], new Highlight(...ranges))
    }

    if (saved.length === 0) {
      CSS.highlights.delete(SAVED_HIGHLIGHT_NAME)
    } else {
      CSS.highlights.set(SAVED_HIGHLIGHT_NAME, new Highlight(...saved))
    }

    this.applyTransientHighlights()
  }

  private applyTransientHighlights(): void {
    if (this.hovered?.range.startContainer.isConnected) {
      CSS.highlights.set(HOVER_HIGHLIGHT_NAME, new Highlight(this.hovered.range))
    } else {
      CSS.highlights.delete(HOVER_HIGHLIGHT_NAME)
    }

    if (this.knownFlash?.range.startContainer.isConnected) {
      CSS.highlights.set(KNOWN_HIGHLIGHT_NAME, new Highlight(this.knownFlash.range))
    } else {
      CSS.highlights.delete(KNOWN_HIGHLIGHT_NAME)
    }
  }

  setHovered(occurrence: MarkedOccurrence | null): void {
    this.hovered = occurrence
    if (!this.supported) return
    this.applyTransientHighlights()
  }

  /** A short confirmation that "我认识" landed, before the mark disappears. */
  flashKnown(occurrence: MarkedOccurrence): void {
    this.knownFlash = occurrence
    if (!this.supported) return
    this.applyTransientHighlights()
  }

  clearKnownFlash(): void {
    this.knownFlash = null
    if (!this.supported) return
    this.applyTransientHighlights()
  }

  /** Every marked word whose dictionary row is this one — a word family. */
  removeOccurrencesOf(entry: LearningDictionaryEntry): MarkedOccurrence[] {
    const removed: MarkedOccurrence[] = []
    this.occurrences = this.occurrences.filter((occurrence) => {
      if (occurrence.entry.w !== entry.w) return true
      removed.push(occurrence)
      return false
    })

    if (removed.length === 0) return removed

    for (const [textNode, slots] of this.byTextNode) {
      const remaining = slots.filter((slot) => slot.occurrence.entry.w !== entry.w)
      if (remaining.length === 0) {
        this.byTextNode.delete(textNode)
      } else {
        this.byTextNode.set(textNode, remaining)
      }
    }

    return removed
  }

  /**
   * Which mark sits under a caret position. The page hands us a text node and
   * an offset (`caretRangeFromPoint` / `caretPositionFromPoint`); the slot list
   * is kept insertion-ordered per node, so a scan is enough — nodes carry a
   * handful of marks each, not thousands.
   *
   * A caret at a mark's trailing edge counts as a hit: pointing at the right
   * half of a word resolves to the offset just after it, and readers aim at the
   * word, not at its leading pixel.
   */
  hitTest(node: Node, offset: number): MarkedOccurrence | null {
    if (node.nodeType !== Node.TEXT_NODE) return null
    const slots = this.byTextNode.get(node as Text)
    if (!slots) return null

    for (const slot of slots) {
      if (offset >= slot.start && offset < slot.end) {
        return slot.occurrence
      }
    }
    for (const slot of slots) {
      if (offset === slot.end) {
        return slot.occurrence
      }
    }
    return null
  }

  reset(): void {
    this.occurrences = []
    this.byTextNode.clear()
    this.hovered = null
    this.knownFlash = null
    if (!this.supported) return
    CSS.highlights.clear()
  }
}
