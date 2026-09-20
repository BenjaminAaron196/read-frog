// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { REACT_SHADOW_HOST_CLASS } from "@/utils/constants/dom-labels"
import { useSubtitlesPanelDismiss } from "../use-subtitles-panel-dismiss"

function mount(onClose: () => void, panel: HTMLElement) {
  const panelRef = createRef<HTMLElement>() as { current: HTMLElement | null }
  panelRef.current = panel
  return renderHook(() => useSubtitlesPanelDismiss({ enabled: true, onClose, panelRef }))
}

/** jsdom has no PointerEvent constructor; MouseEvent carries the same composedPath. */
function pressOn(target: Element) {
  target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }))
}

describe("useSubtitlesPanelDismiss", () => {
  afterEach(() => {
    cleanup()
    document.body.innerHTML = ""
  })

  it("closes on a press that lands outside the panel", () => {
    const panel = document.createElement("div")
    const outside = document.createElement("div")
    document.body.append(panel, outside)
    const onClose = vi.fn<() => void>()
    mount(onClose, panel)

    pressOn(outside)

    expect(onClose).toHaveBeenCalledOnce()
  })

  it("keeps the panel open for a press inside it", () => {
    const panel = document.createElement("div")
    const inside = document.createElement("button")
    panel.append(inside)
    document.body.append(panel)
    const onClose = vi.fn<() => void>()
    mount(onClose, panel)

    pressOn(inside)

    expect(onClose).not.toHaveBeenCalled()
  })

  // Everything the panel portals - the anchored toast, selects, colour pickers,
  // tooltips - leaves the panel's own subtree and lands in a shadow host of the
  // extension's own. Dismissing there hides the toast's anchor mid-press, which
  // turns the button the press was aimed at invisible before its click can land.
  it("keeps the panel open for a press on a popup portalled out of it", () => {
    const panel = document.createElement("div")
    const popupHost = document.createElement("div")
    popupHost.classList.add(REACT_SHADOW_HOST_CLASS)
    const popupRoot = popupHost.attachShadow({ mode: "open" })
    const action = document.createElement("button")
    popupRoot.append(action)
    document.body.append(panel, popupHost)
    const onClose = vi.fn<() => void>()
    mount(onClose, panel)

    pressOn(action)

    expect(onClose).not.toHaveBeenCalled()
  })
})
