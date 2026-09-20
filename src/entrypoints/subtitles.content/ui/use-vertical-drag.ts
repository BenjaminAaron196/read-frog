import type { RefObject } from "react"
import type { SubtitlePosition } from "../atoms"
import { useAtom, useSetAtom } from "jotai"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { DEFAULT_SUBTITLE_POSITION } from "@/utils/constants/subtitles"
import { getContainingShadowRoot } from "@/utils/host/dom/node"
import { subtitlesPositionAtom } from "../atoms"
import { useSubtitlesUI } from "./subtitles-ui-context"
import { useControlsInfo } from "./use-controls-visible"

const BASE_FONT_RATIO = 0.03

interface SubtitleWindowStyle {
  width: number
  height: number
  fontSize: number
}

export interface SubtitlePositionStyle {
  top?: string
  bottom?: string
}

interface Rects {
  container: HTMLDivElement
  videoContainer: HTMLElement
  containerRect: DOMRect
  videoRect: DOMRect
}

interface AnchorPositionContext {
  videoRect: DOMRect
  containerRect: DOMRect
  controlsVisible: boolean
  controlsHeight: number
}

function getVideoContainer(element: HTMLElement): HTMLElement | null {
  const rootNode = getContainingShadowRoot(element)
  const shadowHost = rootNode?.host as HTMLElement | undefined
  return shadowHost?.parentElement ?? null
}

function getRects(containerRef: RefObject<HTMLDivElement | null>): Rects | null {
  const container = containerRef.current
  if (!container) return null

  const videoContainer = getVideoContainer(container)
  if (!videoContainer) return null

  return {
    container,
    videoContainer,
    containerRect: container.getBoundingClientRect(),
    videoRect: videoContainer.getBoundingClientRect(),
  }
}

/**
 * A percent the style can use. The drag math divides by the video's height, and
 * a container that is momentarily collapsed (a fullscreen transition, a hidden
 * player) makes that zero: the quotient is then `NaN`, `top: NaN%` is invalid
 * CSS, and the box stops answering the pointer for the rest of the session -
 * it looks stuck wherever it was.
 */
export function sanitizePercent(value: number, maxPercent: number, minPercent = 0): number {
  if (!Number.isFinite(value)) return minPercent
  const floor = Math.max(0, minPercent)
  const ceiling = Math.max(floor, maxPercent)
  return Math.max(floor, Math.min(ceiling, value))
}

/**
 * How far the box may travel, in percent of the video's height.
 *
 * The drag grip sits just above the box, and it is the only way to move the
 * subtitles again: the range therefore reserves the grip's height, so the
 * subtitles can never be parked with their handle outside the player.
 */
function percentBounds(ctx: {
  videoHeight: number
  containerHeight: number
  reservedHeight: number
  handleHeight: number
  anchor: SubtitlePosition["anchor"]
}): { min: number; max: number } {
  const { videoHeight, containerHeight, reservedHeight, handleHeight, anchor } = ctx
  if (!(videoHeight > 0)) return { min: 0, max: 0 }

  const handlePercent = (handleHeight / videoHeight) * 100
  const max = ((videoHeight - containerHeight - reservedHeight) / videoHeight) * 100 - handlePercent
  return { min: anchor === "top" ? handlePercent : 0, max }
}

function calculateAnchorPosition(ctx: AnchorPositionContext): SubtitlePosition | null {
  const { videoRect, containerRect, controlsVisible, controlsHeight } = ctx
  const videoHeight = videoRect.height
  if (!(videoHeight > 0)) return null

  const subtitleTop = containerRect.top - videoRect.top
  const subtitleCenter = subtitleTop + containerRect.height / 2
  const midPoint = videoHeight / 2

  const anchor = subtitleCenter < midPoint ? "top" : "bottom"

  if (anchor === "top") {
    const percent = (subtitleTop / videoHeight) * 100
    return { percent: Math.max(0, percent), anchor: "top" }
  }

  const subtitleBottom = videoHeight - (containerRect.bottom - videoRect.top)
  const subtitleBottomPercent = (subtitleBottom / videoHeight) * 100
  const controlsOffsetPercent = controlsVisible ? (controlsHeight / videoHeight) * 100 : 0
  const percent = subtitleBottomPercent - controlsOffsetPercent

  return { percent: Math.max(0, percent), anchor: "bottom" }
}

export function useVerticalDrag() {
  const { controlsConfig, containerShrinkRatio } = useSubtitlesUI()
  const windowRef = useRef<HTMLDivElement>(null)
  const { controlsVisible, controlsHeight } = useControlsInfo(windowRef, controlsConfig)
  const setVideoSubtitles = useSetAtom(configFieldsAtomMap.videoSubtitles)
  const containerRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const handleHeightRef = useRef(0)
  const isDraggingRef = useRef(false)
  const startYRef = useRef(0)
  const startPositionRef = useRef<SubtitlePosition>(DEFAULT_SUBTITLE_POSITION)
  const [position, setPosition] = useAtom(subtitlesPositionAtom)
  const [isDragging, setIsDragging] = useState(false)
  const [windowStyle, setWindowStyle] = useState<SubtitleWindowStyle>({
    width: 0,
    height: 0,
    fontSize: 16,
  })

  const updateWindowStyle = useEffectEvent(() => {
    const rects = getRects(containerRef)
    if (!rects) return

    const shrinkRatio = containerShrinkRatio?.(rects.videoContainer) ?? 1

    setWindowStyle({
      width: rects.videoRect.width,
      height: rects.videoRect.height,
      fontSize: rects.videoRect.height * BASE_FONT_RATIO * shrinkRatio,
    })
  })

  const onMouseDown = useEffectEvent((e: MouseEvent) => {
    if (e.button !== 0) return
    isDraggingRef.current = true
    setIsDragging(true)
    startYRef.current = e.clientY
    startPositionRef.current = { ...position }
    e.preventDefault()
    e.stopPropagation()
  })

  const onMouseMove = useEffectEvent((e: MouseEvent) => {
    if (!isDraggingRef.current) return

    const rects = getRects(containerRef)
    if (!rects) return

    const { videoRect, containerRect } = rects
    const videoHeight = videoRect.height
    if (!(videoHeight > 0)) return

    // Calculate deltaY relative to video container height
    const deltaY = e.clientY - startYRef.current
    const deltaPercent = (deltaY / videoHeight) * 100

    // Calculate new position based on current anchor
    const isBottomAnchor = startPositionRef.current.anchor === "bottom"
    let newPercent = isBottomAnchor
      ? startPositionRef.current.percent - deltaPercent
      : startPositionRef.current.percent + deltaPercent

    const reservedHeight =
      controlsVisible && startPositionRef.current.anchor === "bottom" ? controlsHeight : 0
    const bounds = percentBounds({
      videoHeight,
      containerHeight: containerRect.height,
      reservedHeight,
      handleHeight: handleHeightRef.current,
      anchor: startPositionRef.current.anchor,
    })
    newPercent = sanitizePercent(newPercent, bounds.max, bounds.min)

    // Check if we need to switch anchor (crossed midline)
    const newAnchorPosition = calculateAnchorPosition({
      videoRect,
      containerRect,
      controlsVisible,
      controlsHeight,
    })

    // If anchor changed, update start position and reset drag origin
    if (newAnchorPosition && newAnchorPosition.anchor !== startPositionRef.current.anchor) {
      startPositionRef.current = newAnchorPosition
      startYRef.current = e.clientY
      setPosition(newAnchorPosition)
      return
    }

    setPosition({ ...startPositionRef.current, percent: newPercent })
  })

  const onMouseUp = useEffectEvent(() => {
    if (!isDraggingRef.current) return
    isDraggingRef.current = false
    setIsDragging(false)

    void setVideoSubtitles({ position })
  })

  const clampPosition = useEffectEvent(() => {
    const rects = getRects(containerRef)
    if (!rects) return

    const { videoRect, containerRect } = rects
    if (!(videoRect.height > 0)) return

    const bounds = percentBounds({
      videoHeight: videoRect.height,
      containerHeight: containerRect.height,
      reservedHeight: 0,
      handleHeight: handleHeightRef.current,
      anchor: position.anchor,
    })
    const clampedPercent = sanitizePercent(position.percent, bounds.max, bounds.min)

    if (position.percent !== clampedPercent) {
      setPosition({ ...position, percent: clampedPercent })
    }
  })

  const setupListeners = useEffectEvent(() => {
    const handle = handleRef.current
    const container = containerRef.current
    if (!handle || !container) return undefined

    const videoContainer = getVideoContainer(container)
    handleHeightRef.current = handle.getBoundingClientRect().height

    handle.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)

    const resizeObserver = new ResizeObserver(() => {
      updateWindowStyle()
      clampPosition()
    })

    if (videoContainer) {
      resizeObserver.observe(videoContainer)
      updateWindowStyle()
      // A stored position that no longer fits the player is corrected on the way
      // in, rather than waiting for the reader to resize the window.
      clampPosition()
    }

    return () => {
      handle.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
      resizeObserver.disconnect()
    }
  })

  useEffect(() => {
    return setupListeners()
  }, [])

  const controlsOffsetPercent =
    controlsVisible && position.anchor === "bottom" && windowStyle.height > 0
      ? (controlsHeight / windowStyle.height) * 100
      : 0

  // The style is the last line of defence: a percent that is not a finite number
  // would produce invalid CSS and a box that ignores every later drag.
  const safePercent = Number.isFinite(position.percent) ? position.percent : 0
  const positionStyle: SubtitlePositionStyle =
    position.anchor === "top"
      ? { top: `${safePercent}%`, bottom: "unset" }
      : { bottom: `${safePercent + controlsOffsetPercent}%`, top: "unset" }

  return {
    refs: { window: windowRef, container: containerRef, handle: handleRef },
    windowStyle,
    positionStyle,
    isDragging,
  }
}
