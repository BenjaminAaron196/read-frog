import { useAtom } from "jotai"
import { useEffect, useState } from "react"
import { Input } from "@/components/ui/base-ui/input"
import { Switch } from "@/components/ui/base-ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { ConfigItem } from "../../components/config-item"
import { ConfigSection } from "../../components/config-section"

/** The schema's own bounds, so the input cannot write a value the config rejects. */
const MIN_REQUESTS = 0
const MAX_REQUESTS = 200

/**
 * The word card's contextual explanation. It runs on the model the reader chose
 * for page translation, so the section says what it costs instead of offering a
 * provider picker of its own: one request per hovered word, cached, capped per
 * page.
 */
export function AiSection() {
  const [learningMode, setLearningMode] = useAtom(configFieldsAtomMap.learningMode)
  const { ai } = learningMode

  const saveAi = (patch: Partial<typeof ai>) => {
    void setLearningMode({ ...learningMode, ai: { ...ai, ...patch } })
  }

  return (
    <ConfigSection
      id="learning-mode-ai"
      title={i18n.t("learningMode.ai.title")}
      contentClassName="gap-6"
    >
      <ConfigItem
        id="learning-mode-ai-enable"
        title={i18n.t("learningMode.ai.enable")}
        description={i18n.t("learningMode.ai.enableDescription")}
      >
        <Switch checked={ai.enabled} onCheckedChange={(checked) => saveAi({ enabled: checked })} />
      </ConfigItem>

      <ConfigItem
        id="learning-mode-ai-max-requests"
        title={i18n.t("learningMode.ai.maxPerPage")}
        description={i18n.t("learningMode.ai.maxPerPageDescription")}
      >
        <RequestBudgetInput
          value={ai.maxRequestsPerPage}
          onValue={(maxRequestsPerPage) => saveAi({ maxRequestsPerPage })}
        />
      </ConfigItem>
    </ConfigSection>
  )
}

/**
 * A number that stays a draft until it is committed: an empty field, or "12" on
 * the way to "120", must not be written to the config.
 */
function RequestBudgetInput({
  value,
  onValue,
}: {
  value: number
  onValue: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [previousValue, setPreviousValue] = useState(value)

  if (previousValue !== value) {
    setPreviousValue(value)
    setDraft(String(value))
  }

  useEffect(() => {
    return () => {
      setDraft(String(value))
    }
  }, [value])

  const commit = () => {
    const next = Number(draft)
    if (
      draft.trim() !== "" &&
      Number.isInteger(next) &&
      next >= MIN_REQUESTS &&
      next <= MAX_REQUESTS
    ) {
      onValue(next)
      return
    }
    setDraft(String(value))
  }

  return (
    <Input
      type="number"
      inputMode="numeric"
      className="w-24"
      min={MIN_REQUESTS}
      max={MAX_REQUESTS}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
    />
  )
}
