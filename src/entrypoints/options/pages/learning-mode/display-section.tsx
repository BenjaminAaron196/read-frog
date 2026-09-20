import { useAtom } from "jotai"
import { useEffect, useState } from "react"
import { SliderComfortable } from "@/components/ui/base-ui/slider"
import { Switch } from "@/components/ui/base-ui/switch"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { ConfigItem } from "../../components/config-item"
import { ConfigSection } from "../../components/config-section"

/** Matches the schema's own bounds, so the slider cannot write a value it rejects. */
const MIN_INTENSITY = 0.3
const MAX_INTENSITY = 1

/**
 * How the marks look. Every control sits behind its own switch: a reader who
 * wants them quiet keeps the underline and drops the background.
 */
export function DisplaySection() {
  const [learningMode, setLearningMode] = useAtom(configFieldsAtomMap.learningMode)
  const { display } = learningMode

  const saveDisplay = (patch: Partial<typeof display>) => {
    void setLearningMode({ ...learningMode, display: { ...display, ...patch } })
  }

  return (
    <ConfigSection
      id="learning-mode-display"
      title={i18n.t("learningMode.display.title")}
      contentClassName="gap-6"
    >
      <ConfigItem
        id="learning-mode-display-intensity"
        title={i18n.t("learningMode.display.intensity")}
        description={i18n.t("learningMode.display.intensityDescription")}
      >
        <IntensitySlider
          value={display.intensity}
          onValueCommitted={(intensity) => saveDisplay({ intensity })}
        />
      </ConfigItem>

      <ConfigItem
        id="learning-mode-display-min-tier"
        title={i18n.t("learningMode.display.minTier")}
        description={i18n.t("learningMode.display.minTierDescription")}
      >
        <Switch
          checked={display.minTier === "tier2"}
          onCheckedChange={(checked) => saveDisplay({ minTier: checked ? "tier2" : "all" })}
        />
      </ConfigItem>

      <ConfigItem
        id="learning-mode-display-underline"
        title={i18n.t("learningMode.display.underline")}
        description={i18n.t("learningMode.display.underlineDescription")}
      >
        <Switch
          checked={display.underline}
          onCheckedChange={(checked) => saveDisplay({ underline: checked })}
        />
      </ConfigItem>

      <ConfigItem
        id="learning-mode-display-wash"
        title={i18n.t("learningMode.display.wash")}
        description={i18n.t("learningMode.display.washDescription")}
      >
        <Switch
          checked={display.wash}
          onCheckedChange={(checked) => saveDisplay({ wash: checked })}
        />
      </ConfigItem>
    </ConfigSection>
  )
}

/**
 * Dragging is continuous but the config write is not, so the thumb follows a local draft and
 * only the released value is stored. The width is fixed: a slider that stretched with the
 * control column would read a different percentage per point at every window size.
 */
function IntensitySlider({
  value,
  onValueCommitted,
}: {
  value: number
  onValueCommitted: (value: number) => void
}) {
  const [draft, setDraft] = useState(value)

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect, react/no-deriving-state-in-effects -- the draft mirrors the committed value; the slider owns it between commits
    setDraft(value)
  }, [value])

  return (
    <div className="w-56">
      <SliderComfortable
        variant="scrubber"
        aria-label={i18n.t("learningMode.display.intensity")}
        min={MIN_INTENSITY}
        max={MAX_INTENSITY}
        step={0.05}
        value={draft}
        onChange={setDraft}
        onCommit={onValueCommitted}
        formatValue={(v) => `${Math.round(v * 100)}%`}
      />
    </div>
  )
}
