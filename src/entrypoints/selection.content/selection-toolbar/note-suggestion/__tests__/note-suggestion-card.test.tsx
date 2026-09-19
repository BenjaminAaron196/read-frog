// @vitest-environment jsdom
import type { ReactNode } from "react"
import type { NoteSuggestionSessionResult } from "../use-note-suggestion"
import type { Config } from "@/types/config/config"
import type { SelectionToolbarCustomAction } from "@/types/config/selection-toolbar"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { createStore, Provider } from "jotai"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { storage } from "#imports"
import { configAtom } from "@/utils/atoms/config"
import { DEFAULT_CONFIG } from "@/utils/constants/config"
import { i18n } from "@/utils/i18n"

const mocks = vi.hoisted(() => ({
  save: vi.fn<(...args: any[]) => any>(),
  sendMessage: vi.fn<(...args: any[]) => any>(),
  toastAdd: vi.fn<(...args: any[]) => any>(),
  track: vi.fn<(...args: any[]) => any>(),
}))

vi.mock("@/utils/message", () => ({
  sendMessage: (...args: any[]) => mocks.sendMessage(...args),
}))

vi.mock(
  "@/entrypoints/selection.content/selection-toolbar/custom-action-button/use-save-to-notebase",
  () => ({
    useSaveToNotebase: () => ({ save: mocks.save, isSaving: false }),
  }),
)

vi.mock("@/components/ui/base-ui/toast", () => ({
  toastManager: { add: mocks.toastAdd },
}))

vi.mock("@/utils/note-suggestion/analytics", () => ({
  trackNoteSuggestionEvent: (...args: any[]) => mocks.track(...args),
}))

const { NoteSuggestionCard, NoteSuggestionPendingCard } = await import("../note-suggestion-card")

function wrapper(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>
  }
}

function createAction(
  overrides: Partial<SelectionToolbarCustomAction> = {},
): SelectionToolbarCustomAction {
  return {
    id: "save-action",
    name: "Dictionary",
    enabled: true,
    icon: "tabler:book-2",
    providerId: "read-frog-free-ai",
    systemPrompt: "system",
    prompt: "prompt",
    outputSchema: [
      {
        id: "field-term",
        name: "Term",
        type: "string",
        description: "",
        speaking: true,
      },
      {
        id: "field-definition",
        name: "Definition",
        type: "string",
        description: "",
        speaking: false,
      },
    ],
    ...overrides,
  }
}

function createSuggestion(
  actionSnapshot: SelectionToolbarCustomAction,
  notes: Array<Record<string, string | number | null>> = [
    { Term: "ephemeral", Definition: "lasting a very short time" },
  ],
): NoteSuggestionSessionResult {
  return {
    sessionKey: "session-1",
    validated: {
      notes,
      summaryFieldName: "Definition",
    },
    actionSnapshot,
    firedAt: 100,
    analyticsProvider: { provider: "openai", backend_kind: "llm" },
  }
}

function createStoreWithAction(action?: SelectionToolbarCustomAction) {
  const store = createStore()
  const config = structuredClone(DEFAULT_CONFIG)
  config.selectionToolbar.customActions = action ? [action] : []
  config.selectionToolbar.noteSuggestion.actionId = action?.id ?? "default-dictionary"
  store.set(configAtom, config)
  return store
}

function renderCard(
  store: ReturnType<typeof createStore>,
  actionSnapshot: SelectionToolbarCustomAction,
  notes?: Array<Record<string, string | number | null>>,
) {
  return render(
    <NoteSuggestionCard
      suggestion={createSuggestion(actionSnapshot, notes)}
      markShownOnce={() => false}
      selectionText="ephemeral"
      contextText="An ephemeral pleasure."
      sourceTitle="Example article"
      sourceUrl="https://example.com/article"
    />,
    { wrapper: wrapper(store) },
  )
}

function clickSave() {
  fireEvent.click(screen.getByRole("button", { name: i18n.t("noteSuggestion.save") }))
}

describe("NoteSuggestionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.save.mockResolvedValue("saved")
  })

  it("saves through the same action after it is disabled", async () => {
    const snapshot = createAction({ enabled: true })
    const liveAction = createAction({ enabled: false })
    const store = createStoreWithAction(liveAction)
    renderCard(store, snapshot)

    clickSave()

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save).toHaveBeenCalledWith({
      action: liveAction,
      results: [{ Term: "ephemeral", Definition: "lasting a very short time" }],
      analyticsSource: "note_suggestion",
      analyticsProvider: { provider: "openai", backend_kind: "llm" },
    })
    expect(mocks.toastAdd).not.toHaveBeenCalled()
  })

  it("selects every suggested note by default and saves only the checked notes", async () => {
    const action = createAction()
    const store = createStoreWithAction(action)
    renderCard(store, action, [
      { Term: "ephemeral", Definition: "lasting a very short time" },
      { Term: "transient", Definition: "not permanent" },
    ])

    const checkboxes = screen.getAllByRole("checkbox")
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]).toBeChecked()
    expect(checkboxes[1]).toBeChecked()
    expect(checkboxes[0]?.closest('[data-slot="field-label"]')?.firstElementChild).toHaveAttribute(
      "data-slot",
      "field",
    )

    fireEvent.click(screen.getByRole("checkbox", { name: /transient/ }))
    clickSave()

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save.mock.calls[0]?.[0]?.results).toEqual([
      { Term: "ephemeral", Definition: "lasting a very short time" },
    ])
  })

  it("disables saving when every suggested note is unchecked", () => {
    const action = createAction()
    const store = createStoreWithAction(action)
    renderCard(store, action)

    fireEvent.click(screen.getByRole("checkbox", { name: /ephemeral/ }))

    const saveButton = screen.getByRole("button", { name: i18n.t("noteSuggestion.save") })
    expect(saveButton).toBeDisabled()
    fireEvent.click(saveButton)
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("marks the suggestion stale when its action was deleted", async () => {
    const snapshot = createAction()
    const store = createStoreWithAction()
    renderCard(store, snapshot)

    clickSave()

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "error",
        title: i18n.t("noteSuggestion.staleSuggestion"),
      }),
    )
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("marks the suggestion stale when the action schema changed", async () => {
    const snapshot = createAction()
    const liveAction = createAction({
      outputSchema: [
        {
          id: "field-word",
          name: "Word",
          type: "string",
          description: "",
          speaking: true,
        },
      ],
    })
    const store = createStoreWithAction(liveAction)
    renderCard(store, snapshot)

    clickSave()

    await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalledTimes(1))
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it("uses the live action when identity, provider, and connection changed but schema did not", async () => {
    const snapshot = createAction()
    const liveAction = createAction({
      name: "Live Dictionary",
      providerId: "new-provider",
      notebaseConnection: {
        notebaseId: "notebase-live",
        notebaseNameSnapshot: "Live Notes",
        connectedAccount: {
          id: "account-live",
          name: "Reader",
          email: "reader@example.com",
          image: null,
        },
        mappings: [
          {
            id: "mapping-live",
            localFieldId: "field-term",
            notebaseColumnId: "column-live",
            notebaseColumnNameSnapshot: "Term",
          },
        ],
      },
    })
    const store = createStoreWithAction(liveAction)
    renderCard(store, snapshot)

    clickSave()

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1))
    expect(mocks.save.mock.calls[0]?.[0]?.action).toEqual(liveAction)
    expect(mocks.toastAdd).not.toHaveBeenCalled()
  })

  it("preserves the selected action when toggling Note suggestion", async () => {
    const action = createAction()
    const store = createStoreWithAction(action)
    await storage.setItem("local:config", store.get(configAtom))
    renderCard(store, action)

    fireEvent.click(screen.getByRole("switch"))

    const expectedNoteSuggestion = {
      enabled: false,
      actionId: action.id,
      providerId: DEFAULT_CONFIG.selectionToolbar.noteSuggestion.providerId,
    }
    await waitFor(() => {
      expect(store.get(configAtom).selectionToolbar.noteSuggestion).toEqual(expectedNoteSuggestion)
    })
    await waitFor(async () => {
      expect(
        (await storage.getItem<Config>("local:config"))?.selectionToolbar.noteSuggestion,
      ).toEqual(expectedNoteSuggestion)
    })
    await storage.removeItem("local:config")
  })

  it("saves the checked notes into the word book when the Notion button is used", async () => {
    const action = createAction()
    const store = createStoreWithAction(action)
    mocks.sendMessage.mockResolvedValue({
      created: true,
      record: { syncStatus: "pending", syncError: "notion_not_configured" },
    })
    renderCard(store, action, [
      { Term: "ephemeral", Definition: "lasting a very short time" },
      { Term: "perennial", Definition: "lasting a long time" },
    ])

    fireEvent.click(screen.getByRole("checkbox", { name: /perennial/ }))
    fireEvent.click(screen.getByRole("button", { name: i18n.t("noteSuggestion.saveToNotion") }))

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1))
    expect(mocks.sendMessage).toHaveBeenCalledWith("wordBookAdd", {
      word: "ephemeral",
      definition: "Definition: lasting a very short time",
      context: "An ephemeral pleasure.",
      sourceTitle: "Example article",
      sourceUrl: "https://example.com/article",
    })
    // The unchecked note is not written, and the Notebase flow stays untouched.
    expect(mocks.save).not.toHaveBeenCalled()
    await waitFor(() =>
      expect(mocks.track).toHaveBeenCalledWith("suggestion_accepted", expect.anything()),
    )
  })

  it("shows a loading card while the suggestion is still being written", () => {
    const store = createStoreWithAction(createAction())
    render(<NoteSuggestionPendingCard mode="loading" />, { wrapper: wrapper(store) })

    expect(screen.getByText(i18n.t("noteSuggestion.loading"))).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: i18n.t("noteSuggestion.save") }),
    ).not.toBeInTheDocument()
  })

  it("shows why the suggestion failed instead of rendering nothing", () => {
    const store = createStoreWithAction(createAction())
    render(<NoteSuggestionPendingCard mode="error" message="No available channel for model x" />, {
      wrapper: wrapper(store),
    })

    expect(screen.getByText(/No available channel for model x/)).toBeInTheDocument()
  })

  it("hides the Notion button when the word book is disabled", () => {
    const action = createAction()
    const store = createStoreWithAction(action)
    store.set(configAtom, {
      ...store.get(configAtom),
      wordBook: { ...DEFAULT_CONFIG.wordBook, enabled: false },
    })
    renderCard(store, action)

    expect(
      screen.queryByRole("button", { name: i18n.t("noteSuggestion.saveToNotion") }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: i18n.t("noteSuggestion.save") })).toBeInTheDocument()
  })
})
