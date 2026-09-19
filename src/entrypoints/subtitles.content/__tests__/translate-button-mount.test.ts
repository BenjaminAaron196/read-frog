// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { TRANSLATE_BUTTON_CONTAINER_ID } from "@/utils/constants/subtitles"
import { UniversalVideoAdapter } from "../universal-adapter"

function createAdapter(controls?: { insertPosition?: "start" | "end" }) {
  return new UniversalVideoAdapter({
    config: {
      selectors: {
        video: "video",
        playerContainer: ".player",
        controlsBar: ".controls",
        nativeSubtitles: ".native-subtitles",
      },
      events: {},
      ...(controls ? { controls } : {}),
    },
    fetchers: {
      native: () => ({
        fetch: async () => [],
        cleanup: () => {},
        shouldUseSameTrack: async () => false,
        getSourceLanguage: () => "en",
        hasAvailableSubtitles: async () => true,
      }),
    },
  })
}

async function mountButton(controls?: { insertPosition?: "start" | "end" }) {
  document.body.innerHTML = `
    <div class="player">
      <div class="controls">
        <button id="play"></button>
        <button id="mute"></button>
      </div>
    </div>`

  const adapter = createAdapter(controls) as unknown as {
    renderTranslateButton: () => Promise<void>
  }
  await adapter.renderTranslateButton()

  return document.querySelector(".controls") as HTMLElement
}

describe("translate button mounting", () => {
  afterEach(() => {
    document.body.innerHTML = ""
  })

  it("mounts at the end of the control bar when the platform asks for it", async () => {
    const controls = await mountButton({ insertPosition: "end" })

    expect(controls.lastElementChild?.id).toBe(TRANSLATE_BUTTON_CONTAINER_ID)
    expect(controls.firstElementChild?.id).toBe("play")
  })

  it("mounts at the start of the control bar by default", async () => {
    const controls = await mountButton()

    expect(controls.firstElementChild?.id).toBe(TRANSLATE_BUTTON_CONTAINER_ID)
  })
})
