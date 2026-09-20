// @vitest-environment jsdom

import type { Config } from "@/types/config/config"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { browser } from "#imports"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import {
  LEARNING_DICTIONARY_ENTRIES_KEY,
  LEARNING_DICTIONARY_META_KEY,
} from "@/utils/constants/learning-mode"
import { i18n } from "@/utils/i18n"
import { LearningModePage } from "../index"

const {
  learningModeAtom,
  setLearningModeMock,
  testState,
  toastAddMock,
  storageSetMock,
  readDictionaryMetaMock,
} = vi.hoisted(() => ({
  learningModeAtom: {},
  setLearningModeMock: vi.fn<(value: Partial<Config["learningMode"]>) => Promise<void>>(),
  testState: {
    learningMode: null as Config["learningMode"] | null,
  },
  toastAddMock: vi.fn<(options: { title: string }) => void>(),
  storageSetMock: vi.fn<(items: Record<string, unknown>) => Promise<void>>(),
  readDictionaryMetaMock: vi.fn<() => Promise<Config["learningMode"] | null>>(),
}))

vi.mock("jotai", () => ({
  useAtom: (atom: object) => {
    if (atom !== learningModeAtom || !testState.learningMode) {
      throw new Error("Unexpected atom")
    }
    return [testState.learningMode, setLearningModeMock]
  },
}))

vi.mock("@/utils/atoms/config", () => ({
  configFieldsAtomMap: {
    learningMode: learningModeAtom,
  },
}))

vi.mock("@/components/ui/base-ui/toast", () => ({
  toastManager: { add: toastAddMock },
}))

// The dictionary itself lives in extension storage, which this suite does not
// stand up; the section only needs to know what is there.
vi.mock("@/utils/learning-mode/lookup", () => ({
  readDictionaryMeta: readDictionaryMetaMock,
}))

/**
 * The artifact shape the build script writes, trimmed to a few entries. Built
 * through a function because `meta.bytes` counts the file around it: the builder
 * solves for its own digit count, and the page rejects a file smaller than its
 * claim.
 */
function buildArtifact(
  variant: "lite" | "full",
  entries: unknown[],
): { json: string; bytes: number } {
  const payload = {
    meta: {
      version: "2026-09-20",
      variant,
      entries: entries.length,
      bytes: 0,
      importedAt: 1_700_000_000_000,
      source: "github.com/skywind3000/ECDICT",
    },
    entries,
  }

  let json = JSON.stringify(payload)
  let bytes = new TextEncoder().encode(json).length
  while (payload.meta.bytes !== bytes) {
    payload.meta.bytes = bytes
    json = JSON.stringify(payload)
    bytes = new TextEncoder().encode(json).length
  }
  return { json, bytes }
}

const LITE_ARTIFACT = buildArtifact("lite", [
  { w: "perceive", frq: 3200, cefr: "B1" },
  { w: "perceived", l: "perceive", frq: 5100 },
])

describe("learning mode page", () => {
  beforeEach(() => {
    testState.learningMode = structuredClone(DEFAULT_CONFIG.learningMode)
    setLearningModeMock.mockReset()
    setLearningModeMock.mockResolvedValue()
    toastAddMock.mockReset()
    // The suite's fake browser is the one the page reaches, so the write is
    // observed on it rather than on a mock of the module.
    storageSetMock.mockReset()
    storageSetMock.mockResolvedValue()
    browser.storage.local.set = storageSetMock
    readDictionaryMetaMock.mockReset()
    readDictionaryMetaMock.mockResolvedValue(null)
  })

  it("turns the feature on without dropping the rest of the section", async () => {
    render(<LearningModePage />)
    await waitFor(() => expect(readDictionaryMetaMock).toHaveBeenCalled())

    const enableRow = document.getElementById("learning-mode-enable")!
    fireEvent.click(within(enableRow).getByRole("switch"))

    expect(setLearningModeMock).toHaveBeenCalledWith({ ...testState.learningMode, enabled: true })
  })

  it("keeps the other profile parameters when one of them changes", async () => {
    testState.learningMode!.profile = {
      kind: "vocabSize",
      exam: "gre",
      cefrLevel: "C2",
      vocabSize: 8000,
    }

    render(<LearningModePage />)
    await waitFor(() => expect(readDictionaryMetaMock).toHaveBeenCalled())

    const input = within(document.getElementById("learning-mode-profile-vocab-size")!).getByRole(
      "spinbutton",
    )
    fireEvent.change(input, { target: { value: "20000" } })

    expect(setLearningModeMock).toHaveBeenCalledWith({
      ...testState.learningMode,
      profile: { kind: "vocabSize", exam: "gre", cefrLevel: "C2", vocabSize: 20000 },
    })
  })

  it("restores the last good vocabulary size when the field is left unusable", async () => {
    testState.learningMode!.profile = {
      kind: "vocabSize",
      exam: "gre",
      cefrLevel: "C2",
      vocabSize: 8000,
    }

    render(<LearningModePage />)
    await waitFor(() => expect(readDictionaryMetaMock).toHaveBeenCalled())

    const input = within(document.getElementById("learning-mode-profile-vocab-size")!).getByRole(
      "spinbutton",
    )
    fireEvent.change(input, { target: { value: "10" } })
    fireEvent.blur(input)

    expect(setLearningModeMock).not.toHaveBeenCalled()
    expect(input).toHaveValue(8000)
    expect(toastAddMock).toHaveBeenCalledWith({
      type: "error",
      title: i18n.t("learningMode.profile.vocabSizeError", ["500", "60000"]),
    })
  })

  it("stores a trimmed, deduplicated list of excluded pages", async () => {
    render(<LearningModePage />)
    await waitFor(() => expect(readDictionaryMetaMock).toHaveBeenCalled())

    const textarea = screen.getByPlaceholderText(i18n.t("learningMode.exclude.placeholder"))
    fireEvent.change(textarea, {
      target: { value: "*.example.com\n  *.example.com \n\n*.news.site\n" },
    })
    fireEvent.blur(textarea)

    expect(setLearningModeMock).toHaveBeenCalledWith({
      ...testState.learningMode,
      excludedPatterns: ["*.example.com", "*.news.site"],
    })
  })

  it("rejects an edit that contains an unmatchable pattern instead of dropping the line", async () => {
    render(<LearningModePage />)
    await waitFor(() => expect(readDictionaryMetaMock).toHaveBeenCalled())

    const textarea = screen.getByPlaceholderText(i18n.t("learningMode.exclude.placeholder"))
    fireEvent.change(textarea, { target: { value: "ftp://example.com\n*.example.com" } })
    fireEvent.blur(textarea)

    expect(setLearningModeMock).not.toHaveBeenCalled()
    expect(toastAddMock).toHaveBeenCalledWith({
      type: "error",
      title: i18n.t("options.patterns.unsupported"),
    })
  })

  it("imports an artifact of the selected variant into both storage keys", async () => {
    const { container } = render(<LearningModePage />)
    await waitFor(() => expect(readDictionaryMetaMock).toHaveBeenCalled())

    const file = new File([LITE_ARTIFACT.json], "dictionary-lite.json", {
      type: "application/json",
    })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })

    await waitFor(() => expect(storageSetMock).toHaveBeenCalledTimes(1))
    const stored = storageSetMock.mock.calls[0]![0]
    expect(stored[LEARNING_DICTIONARY_META_KEY]).toMatchObject({
      version: "2026-09-20",
      variant: "lite",
      entries: 2,
      bytes: LITE_ARTIFACT.bytes,
      source: "github.com/skywind3000/ECDICT",
      // The status line reports when THIS copy arrived, not when it was built.
      importedAt: expect.any(Number),
    })
    expect(stored[LEARNING_DICTIONARY_META_KEY]).not.toMatchObject({
      importedAt: 1_700_000_000_000,
    })
    expect(stored[LEARNING_DICTIONARY_ENTRIES_KEY]).toHaveLength(2)
  })

  it("refuses the other variant's file and writes nothing", async () => {
    const { container } = render(<LearningModePage />)
    await waitFor(() => expect(readDictionaryMetaMock).toHaveBeenCalled())

    const fullArtifact = buildArtifact("full", [
      { w: "perceive", frq: 3200, cefr: "B1" },
      { w: "perceived", l: "perceive", frq: 5100 },
    ])
    const file = new File([fullArtifact.json], "dictionary-full.json", {
      type: "application/json",
    })
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } })

    await waitFor(() => expect(toastAddMock).toHaveBeenCalled())
    expect(storageSetMock).not.toHaveBeenCalled()
    expect(toastAddMock).toHaveBeenCalledWith({
      type: "error",
      title: i18n.t("learningMode.dictionary.import.variantMismatch", [
        i18n.t("learningMode.dictionary.status.variantFull"),
      ]),
    })
  })
})
