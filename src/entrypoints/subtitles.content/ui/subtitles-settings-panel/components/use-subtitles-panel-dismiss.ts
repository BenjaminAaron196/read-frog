import type { RefObject } from "react"
import { useEffect, useEffectEvent } from "react"
import { REACT_SHADOW_HOST_CLASS } from "@/utils/constants/dom-labels"

function isElement(value: EventTarget | null): value is Element {
  return value instanceof Element
}

/**
 * Whether the press belongs to Read Frog's own interface.
 *
 * Every surface the extension renders - the panel, the frog that opens it, and
 * anything portalled out of the panel (tooltips, selects, colour pickers,
 * toasts, dialogs) - lives in a shadow host carrying this class. A press there
 * is never a press on the page, so it must not dismiss the panel. Listing the
 * portalled popups by `data-slot` instead meant every new popup had to be
 * remembered here, and the symptom of forgetting was the panel vanishing the
 * moment the reader touched that popup.
 */
function isReadFrogUi(path: EventTarget[]): boolean {
  return path.some(
    (target) => isElement(target) && target.classList.contains(REACT_SHADOW_HOST_CLASS),
  )
}

interface UseSubtitlesPanelDismissOptions {
  enabled: boolean
  onClose: () => void
  panelRef: RefObject<HTMLElement | null>
}

export function useSubtitlesPanelDismiss({
  enabled,
  onClose,
  panelRef,
}: UseSubtitlesPanelDismissOptions) {
  const onPointerDown = useEffectEvent((event: PointerEvent) => {
    if (!enabled) {
      return
    }

    const path = event.composedPath()
    const clickedInsidePanel = !!panelRef.current && path.includes(panelRef.current)

    if (clickedInsidePanel || isReadFrogUi(path)) {
      return
    }

    onClose()
  })

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (!enabled) {
      return
    }

    if (event.key === "Escape") {
      onClose()
    }
  })

  useEffect(() => {
    document.addEventListener("pointerdown", onPointerDown, true)
    document.addEventListener("keydown", onKeyDown, true)

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true)
      document.removeEventListener("keydown", onKeyDown, true)
    }
  }, [])
}
