import type { LearningDictionaryEntry, LearningMatch, LearningTier } from "./types"

/**
 * Marks live as CSS custom highlights: a `Range` per marked word, registered
 * under one name per tier. Nothing is inserted into the page, so the marks
 * cannot disturb the site's own rendering, the page translation's wrappers, or
 * React's reconciliation.
 */
export interface MarkedOccurrence {
  /** Stable for the page's lifetime: two copies of a word are different marks. */
  id: number
  range: Range
  tier: LearningTier
  entry: LearningDictionaryEntry
  surface: string
  sentence: string
}

/** Whether a point falls inside a box, with a little slack for rounding. */
function containsPoint(
  rect: { left: number; right: number; top: number; bottom: number },
  point: { x: number; y: number },
  margin = 4,
): boolean {
  return (
    point.x >= rect.left - margin &&
    point.x <= rect.right + margin &&
    point.y >= rect.top - margin &&
    point.y <= rect.bottom + margin
  )
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
  private nextId = 0

  private byTextNode = new Map<Text, OccurrenceSlot[]>()

  private savedWords = new Set<string>()

  private hovered: MarkedOccurrence | null = null

  private knownFlash: MarkedOccurrence | null = null

  /**
   * The registry entries, kept alive between paints. Rebuilding them from the
   * whole occurrence list after every scan batch is what made a large article
   * stutter: thousands of ranges reallocated per batch. A `Highlight` is a set,
   * so a paint only adds and removes what changed.
   */
  private tierHighlights: Record<LearningTier, Highlight> | null = null

  private savedHighlight: Highlight | null = null

  /** What each occurrence is currently painted as, so a paint can diff. */
  private painted = new Map<MarkedOccurrence, LearningTier | "saved">()

  private commitScheduled = false

  /**
   * Mark boxes, measured once per layout epoch. Hit-testing asks for a rect on
   * every pointer move, and a rect read forces layout - on a page the translator
   * is still writing to, that is the most expensive thing the hover path could
   * do. The epoch is bumped when the page moves under the marks.
   */
  private rects = new Map<MarkedOccurrence, DOMRect>()

  private rectEpoch = 0

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
    this.nextId += 1
    const occurrence: MarkedOccurrence = {
      id: this.nextId,
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

  /**
   * Publishes the marks, at most once per frame.
   *
   * A scan adds hundreds of ranges in a batch, and the page moves under them
   * while a translation runs; painting on every batch is what kept the main
   * thread busy. The work itself is incremental: a paint walks the occurrences
   * and touches only the ones whose tier changed.
   */
  commit(): void {
    if (!this.supported || this.commitScheduled) return
    this.commitScheduled = true
    requestAnimationFrame(() => {
      this.commitScheduled = false
      this.paint()
    })
  }

  /** Which registry entry an occurrence belongs in, right now. */
  private slotFor(occurrence: MarkedOccurrence): LearningTier | "saved" | null {
    if (!occurrence.range.startContainer.isConnected) return null
    return this.savedWords.has(occurrence.entry.w) ? "saved" : occurrence.tier
  }

  private paint(): void {
    this.ensureRegistry()
    if (!this.tierHighlights || !this.savedHighlight) return

    const entryFor = (slot: LearningTier | "saved"): Highlight =>
      slot === "saved" ? this.savedHighlight! : this.tierHighlights![slot]

    for (const occurrence of this.occurrences) {
      const desired = this.slotFor(occurrence)
      const current = this.painted.get(occurrence) ?? null
      if (current === desired) continue

      if (current) entryFor(current).delete(occurrence.range)
      if (desired) entryFor(desired).add(occurrence.range)
      if (desired) this.painted.set(occurrence, desired)
      else this.painted.delete(occurrence)
    }

    // Marks removed from the list entirely (a word the reader marked as known)
    // are not in the loop above, so they are unpainted from here.
    for (const [occurrence, current] of this.painted) {
      if (this.occurrences.includes(occurrence)) continue
      entryFor(current).delete(occurrence.range)
      this.painted.delete(occurrence)
      this.rects.delete(occurrence)
    }

    // The paint itself can move what the marks sit on; the next measurement is
    // taken after that settles rather than reused.
    this.invalidateRects()
    this.applyTransientHighlights()
  }

  private ensureRegistry(): void {
    if (this.tierHighlights && this.savedHighlight) return
    this.tierHighlights = {
      tier1: new Highlight(),
      tier2: new Highlight(),
      tier3: new Highlight(),
    }
    this.savedHighlight = new Highlight()
    for (const tier of Object.keys(this.tierHighlights) as LearningTier[]) {
      CSS.highlights.set(TIER_HIGHLIGHT_NAME[tier], this.tierHighlights[tier])
    }
    CSS.highlights.set(SAVED_HIGHLIGHT_NAME, this.savedHighlight)
  }

  /** Marks every cached box stale; the next hit test measures afresh. */
  invalidateRects(): void {
    this.rectEpoch += 1
    this.rects.clear()
  }

  /** The box of a mark, measured at most once per layout epoch. */
  private rectOf(occurrence: MarkedOccurrence): DOMRect {
    const cached = this.rects.get(occurrence)
    if (cached) return cached
    const rect = occurrence.range.getBoundingClientRect()
    this.rects.set(occurrence, rect)
    return rect
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
  hitTest(node: Node, offset: number, point?: { x: number; y: number }): MarkedOccurrence | null {
    if (node.nodeType !== Node.TEXT_NODE) return null
    const slots = this.byTextNode.get(node as Text)
    if (!slots) return null

    for (const slot of slots) {
      if (offset >= slot.start && offset < slot.end) {
        return slot.occurrence
      }
    }

    // A caret at a mark's trailing edge counts as a hit: pointing at the right
    // half of a word resolves to the offset just after it, and readers aim at the
    // word, not at its leading pixel. Chromium also clamps a caret in empty space
    // to the nearest text position, so the far end of a line resolves to the end
    // of its last word - which is why this rule only stands when the pointer is
    // actually on that word's box.
    for (const slot of slots) {
      if (offset !== slot.end) continue
      if (point && !containsPoint(this.rectOf(slot.occurrence), point)) {
        continue
      }
      return slot.occurrence
    }
    return null
  }

  /**
   * Which mark covers a point on screen, measured from the marks themselves.
   *
   * The caret is the cheaper source, but it answers in layout space: inside an
   * animated or transformed subtree it points at a sibling copy of the same
   * text, and the card would then describe (and sit beside) a word the reader is
   * not looking at. Geometry is the authority when the two disagree.
   */
  hitTestPoint(x: number, y: number, margin = 4): MarkedOccurrence | null {
    // First hit wins: every candidate costs a forced layout, and a page can carry
    // thousands of marks. The caller only reaches here when the caret named a mark
    // whose box does not cover the pointer, so the answer is a correction, not a
    // survey.
    for (const occurrence of this.occurrences) {
      const rect = this.rectOf(occurrence)
      if (rect.width === 0 && rect.height === 0) continue
      if (
        x < rect.left - margin ||
        x > rect.right + margin ||
        y < rect.top - margin ||
        y > rect.bottom + margin
      ) {
        continue
      }
      return occurrence
    }
    return null
  }

  reset(): void {
    this.occurrences = []
    this.byTextNode.clear()
    this.hovered = null
    this.knownFlash = null
    this.painted.clear()
    this.rects.clear()
    this.tierHighlights = null
    this.savedHighlight = null
    if (!this.supported) return
    CSS.highlights.clear()
  }
}
