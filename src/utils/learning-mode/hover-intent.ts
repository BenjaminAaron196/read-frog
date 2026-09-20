/**
 * What the hover card should do when the pointer moves.
 *
 * The caret under the pointer is the only hit source available on a page (the
 * marks are CSS highlights, not elements), and it is noisy: at a word's edge it
 * snaps to the neighbouring word, and over the card itself it lands on the card
 * rather than on text. Deciding from the caret alone makes the card jump between
 * neighbours and vanish when the reader reaches for its buttons.
 *
 * So the decision is separated from the measuring: the caller reports what is
 * under the pointer, and this module keeps the card where it is until something
 * clearly different has been under the pointer for a moment, or until the
 * pointer has genuinely left the word that opened it.
 */

/** A different word must stay under the pointer this long before the card follows it. */
export const HOVER_SWITCH_DELAY_MS = 140

export interface HoverIntent {
  /** The mark the card belongs to; null when no card is open. */
  occurrenceId: number | null
  /** A different mark seen under the pointer, waiting out the switch delay. */
  candidateId: number | null
  candidateSince: number
}

export function createHoverIntent(): HoverIntent {
  return { occurrenceId: null, candidateId: null, candidateSince: 0 }
}

export interface HoverObservation {
  /**
   * The mark under the caret, or null when the pointer is not over one. Identity
   * matters, not the headword: the same word appears many times on a page, and
   * the card has to follow the pointer from one copy to the next.
   */
  occurrenceId: number | null
  now: number
  /** The pointer is over the card itself: it must never be taken away there. */
  isPointerOverCard: boolean
  /**
   * The pointer is still inside the rect of the word the card belongs to. The
   * caret can miss a mark it is visually on (the trailing half of a word
   * resolves past it), and that must not close the card either.
   */
  isWithinOpenWordRect: boolean
}

export type HoverAction = "keep" | "open" | "switch" | "hide"

export interface HoverDecision {
  action: HoverAction
  intent: HoverIntent
}

/**
 * Folds one pointer observation into the intent. `open` means "open the card
 * for this word" (nothing was open), `switch` means "move the open card to this
 * word" — the caller treats them the same, and the distinction is only used by
 * the tests to name what happened.
 */
export function decideHover(intent: HoverIntent, observation: HoverObservation): HoverDecision {
  const { occurrenceId, now, isPointerOverCard, isWithinOpenWordRect } = observation

  // Reaching for the card's buttons is the point of the delay; never hide there.
  if (isPointerOverCard) {
    return { action: "keep", intent }
  }

  if (occurrenceId === null) {
    // An empty caret inside the mark the card was opened on is measurement
    // noise, not a pointer that left.
    if (intent.occurrenceId !== null && isWithinOpenWordRect) {
      return { action: "keep", intent }
    }
    return { action: "hide", intent: createHoverIntent() }
  }

  // Still on the mark the card describes - including its outer pixels, where the
  // caret may already resolve to the neighbour.
  if (occurrenceId === intent.occurrenceId || isWithinOpenWordRect) {
    return { action: "keep", intent: { ...intent, candidateId: null, candidateSince: 0 } }
  }

  if (intent.occurrenceId === null) {
    return { action: "open", intent: { occurrenceId, candidateId: null, candidateSince: 0 } }
  }

  if (intent.candidateId === occurrenceId && now - intent.candidateSince >= HOVER_SWITCH_DELAY_MS) {
    return { action: "switch", intent: { occurrenceId, candidateId: null, candidateSince: 0 } }
  }

  if (intent.candidateId === occurrenceId) {
    return { action: "keep", intent }
  }

  return {
    action: "keep",
    intent: { occurrenceId: intent.occurrenceId, candidateId: occurrenceId, candidateSince: now },
  }
}
