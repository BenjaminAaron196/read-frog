import { useAtom } from "jotai"
import { useState } from "react"
import { Switch } from "@/components/ui/base-ui/switch"
import { Textarea } from "@/components/ui/base-ui/textarea"
import { toastManager } from "@/components/ui/base-ui/toast"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { getUserSitePatternError } from "@/utils/url-pattern"
import { ConfigItem } from "../../components/config-item"
import { PageLayout } from "../../components/page-layout"
import { AiSection } from "./ai-section"
import { DictionarySection } from "./dictionary-section"
import { DisplaySection } from "./display-section"
import { ProfileSection } from "./profile-section"

function LearningModeEnableItem() {
  const [learningMode, setLearningMode] = useAtom(configFieldsAtomMap.learningMode)

  return (
    <ConfigItem
      id="learning-mode-enable"
      title={i18n.t("learningMode.panel.enable")}
      description={i18n.t("learningMode.panel.enableDescription")}
      orientation="horizontal"
    >
      <Switch
        checked={learningMode.enabled}
        onCheckedChange={(checked) => void setLearningMode({ ...learningMode, enabled: checked })}
      />
    </ConfigItem>
  )
}

/**
 * Sites the marks stay off, one URL pattern per line. A textarea rather than the
 * table the other pattern lists use: these are pasted in bulk far more often than
 * they are edited one row at a time.
 */
function ExcludedPatternsItem() {
  const [learningMode, setLearningMode] = useAtom(configFieldsAtomMap.learningMode)
  const stored = learningMode.excludedPatterns.join("\n")
  const [draft, setDraft] = useState(stored)
  const [prevStored, setPrevStored] = useState(stored)

  // Reset the draft when the stored list changes from somewhere else.
  if (prevStored !== stored) {
    setPrevStored(stored)
    setDraft(stored)
  }

  const commit = () => {
    const patterns = [...new Set(draft.split("\n").map((line) => line.trim()))].filter(
      (line) => line !== "",
    )
    // One unmatchable line rejects the whole edit rather than being dropped
    // silently: the pattern the user typed is what the list has to say.
    for (const pattern of patterns) {
      const error = getUserSitePatternError(pattern)
      if (error !== null && error !== "empty") {
        toastManager.add({ type: "error", title: i18n.t(`options.patterns.${error}`) })
        setDraft(stored)
        return
      }
    }

    void setLearningMode({ ...learningMode, excludedPatterns: patterns })
  }

  return (
    <ConfigItem
      id="learning-mode-excluded-patterns"
      title={i18n.t("learningMode.exclude.title")}
      description={i18n.t("learningMode.exclude.description")}
      orientation="vertical"
    >
      <Textarea
        value={draft}
        placeholder={i18n.t("learningMode.exclude.placeholder")}
        rows={4}
        className="font-mono text-[13px]"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
      />
    </ConfigItem>
  )
}

export function LearningModePage() {
  return (
    <PageLayout
      title={i18n.t("learningMode.panel.title")}
      description={i18n.t("learningMode.panel.description")}
      innerClassName="flex flex-col gap-10"
    >
      <LearningModeEnableItem />
      <ProfileSection />
      <DisplaySection />
      <AiSection />
      <ExcludedPatternsItem />
      <DictionarySection />
    </PageLayout>
  )
}
