import { useAtom, useAtomValue } from "jotai"
import { useEffect, useState } from "react"
import { browser } from "#imports"
import { HelpTooltip } from "@/components/help-tooltip"
import { getPageTranslatePromptSelectItems } from "@/components/prompt-configurator/built-in-prompts"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { isLLMProvider } from "@/types/config/provider"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { featureProviderRefAtom } from "@/utils/atoms/provider"
import { DEFAULT_TRANSLATE_PROMPT_ID } from "@/utils/constants/prompt"
import { i18n } from "@/utils/i18n"
import { sendMessage } from "@/utils/message"
import { SMART_TRANSLATE_PROMPT_ID } from "@/utils/translate/style-router"

/**
 * What "smart" picked for this tab, so the reader can see the choice rather than
 * trust it. The verdict is the background's (one model call per URL); until it
 * answers, the label says so.
 */
function useResolvedStyleLabel(
  promptId: string | null | undefined,
  items: { value: string; label: string }[],
): string | null {
  const [label, setLabel] = useState<string | null>(null)

  const isSmart = promptId === SMART_TRANSLATE_PROMPT_ID

  useEffect(() => {
    if (!isSmart) return undefined

    let cancelled = false
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
      if (!tab?.url) return
      const answer = await sendMessage("translateStyleVerdict", {
        url: tab.url,
        title: tab.title ?? null,
        description: null,
      }).catch(() => null)
      if (cancelled) return
      const styleId = answer?.styleId ?? null
      const style = items.find((item) => item.value === styleId)
      setLabel(
        style
          ? i18n.t("translatePrompt.smart", [style.label])
          : i18n.t("translatePrompt.smartNone"),
      )
    })()

    return () => {
      cancelled = true
    }
  }, [isSmart, items])

  if (!isSmart) return null
  // Derived, not stored: the answer is what the background says, and until it
  // says anything the label names that state.
  return label ?? i18n.t("translatePrompt.smartPending")
}

export default function TranslatePromptSelector() {
  const translateProviderRef = useAtomValue(featureProviderRefAtom("pageTranslation"))
  const [translateConfig, setTranslateConfig] = useAtom(configFieldsAtomMap.pageTranslation)

  const customPromptsConfig = translateConfig.customPromptsConfig
  const { patterns, promptId } = customPromptsConfig
  const items = getPageTranslatePromptSelectItems(patterns)
  // Unconditional: the hook order must not depend on the provider check below.
  const showSelector =
    !!translateProviderRef &&
    !(translateProviderRef.kind === "local" && !isLLMProvider(translateProviderRef.config.provider))

  const resolvedStyle = useResolvedStyleLabel(promptId, items)

  if (!showSelector) return null

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5 text-[13px] font-medium">
        {i18n.t("translatePrompt.title")}
        <HelpTooltip>{i18n.t("translatePrompt.description")}</HelpTooltip>
      </span>
      <Select
        items={items}
        value={promptId ?? DEFAULT_TRANSLATE_PROMPT_ID}
        onValueChange={(value) => {
          void setTranslateConfig({
            customPromptsConfig: {
              ...customPromptsConfig,
              promptId: value ?? DEFAULT_TRANSLATE_PROMPT_ID,
            },
          })
        }}
      >
        <SelectTrigger className="h-7! w-31 pr-1.5 pl-2.5">
          <SelectValue>{resolvedStyle ?? undefined}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}
