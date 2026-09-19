// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  getActiveReutersPlayer,
  getActiveReutersVideoId,
  rememberReutersPlayerVideoId,
  setActiveReutersPlayer,
  watchReutersPlayingVideo,
} from "../video-id"

function renderPlayers(count: number) {
  document.body.innerHTML = Array.from(
    { length: count },
    (_, index) =>
      `<div class="jwplayer" id="player-${index}"><video class="jw-video"></video></div>`,
  ).join("")
  return [...document.querySelectorAll<HTMLElement>(".jwplayer")]
}

describe("reuters player tracking", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("follows one player at a time", () => {
    const [first, second] = renderPlayers(2)

    setActiveReutersPlayer(first!)
    expect(getActiveReutersPlayer()).toBe(first)

    setActiveReutersPlayer(second!)
    expect(getActiveReutersPlayer()).toBe(second)
    expect(first?.hasAttribute("data-read-frog-reuters-player")).toBe(false)
  })

  it("gives every player on the page its own video id", () => {
    const [first, second] = renderPlayers(2)

    setActiveReutersPlayer(first!)
    const firstId = getActiveReutersVideoId()
    setActiveReutersPlayer(second!)
    const secondId = getActiveReutersVideoId()

    expect(firstId).not.toBeNull()
    expect(secondId).not.toBeNull()
    expect(firstId).not.toBe(secondId)
  })

  it("prefers the ajo id once the player has been asked for it", () => {
    const [first] = renderPlayers(1)
    setActiveReutersPlayer(first!)
    const placeholderId = getActiveReutersVideoId()

    rememberReutersPlayerVideoId(first!, "788331")

    expect(getActiveReutersVideoId()).toBe("788331")
    expect(placeholderId).not.toBe("788331")
  })

  it("reports the player a video starts playing inside", () => {
    const [, second] = renderPlayers(2)
    const onPlay = vi.fn<(...args: unknown[]) => void>()

    const stop = watchReutersPlayingVideo(onPlay)
    second!.querySelector("video")!.dispatchEvent(new Event("play"))

    expect(onPlay).toHaveBeenCalledWith(second)
    stop()

    onPlay.mockClear()
    second!.querySelector("video")!.dispatchEvent(new Event("play"))
    expect(onPlay).not.toHaveBeenCalled()
  })
})
