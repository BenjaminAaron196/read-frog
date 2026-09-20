import type { ExamTag, LearningProfileKind } from "@/utils/learning-mode/types"
import { useAtom } from "jotai"
import { useState } from "react"
import { Input } from "@/components/ui/base-ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-ui/select"
import { toastManager } from "@/components/ui/base-ui/toast"
import { configFieldsAtomMap } from "@/utils/atoms/config"
import { i18n } from "@/utils/i18n"
import { CEFR_LEVELS, EXAM_TAGS } from "@/utils/learning-mode/types"
import { ConfigItem } from "../../components/config-item"
import { ConfigSection } from "../../components/config-section"

const PROFILE_KINDS = ["exam", "cefr", "vocabSize"] as const

const KIND_LABEL_KEY = {
  exam: "learningMode.profile.kindExam",
  cefr: "learningMode.profile.kindCefr",
  vocabSize: "learningMode.profile.kindVocabSize",
} as const satisfies Record<LearningProfileKind, string>

const EXAM_TAG_LABEL_KEY = {
  zk: "learningMode.examTags.zk",
  gk: "learningMode.examTags.gk",
  cet4: "learningMode.examTags.cet4",
  cet6: "learningMode.examTags.cet6",
  ky: "learningMode.examTags.ky",
  toefl: "learningMode.examTags.toefl",
  ielts: "learningMode.examTags.ielts",
  gre: "learningMode.examTags.gre",
} as const satisfies Record<ExamTag, string>

/** The range the config schema accepts, so a typed number can be rejected here. */
const MIN_VOCAB_SIZE = 500
const MAX_VOCAB_SIZE = 60000

/**
 * One profile decides which words count as hard — an exam syllabus, a CEFR band
 * or a vocabulary-size target. Exactly one is active: with a single profile there
 * is no union of several verdicts to reason about, and the answer to "why is this
 * word marked?" stays one sentence.
 */
export function ProfileSection() {
  const [learningMode, setLearningMode] = useAtom(configFieldsAtomMap.learningMode)
  const { profile } = learningMode

  const saveProfile = (patch: Partial<typeof profile>) => {
    void setLearningMode({ ...learningMode, profile: { ...profile, ...patch } })
  }

  return (
    <ConfigSection
      id="learning-mode-profile"
      title={i18n.t("learningMode.profile.title")}
      contentClassName="gap-6"
    >
      <ConfigItem
        id="learning-mode-profile-kind"
        title={i18n.t("learningMode.profile.kind")}
        description={i18n.t("learningMode.profile.description")}
      >
        <Select
          items={PROFILE_KINDS.map((kind) => ({
            value: kind,
            label: i18n.t(KIND_LABEL_KEY[kind]),
          }))}
          value={profile.kind}
          onValueChange={(value) => {
            const parsedKind = PROFILE_KINDS.find((kind) => kind === value)
            if (parsedKind) saveProfile({ kind: parsedKind })
          }}
        >
          <SelectTrigger size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              {PROFILE_KINDS.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {i18n.t(KIND_LABEL_KEY[kind])}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </ConfigItem>

      {/* Only the control the active kind uses: the other two keep their stored
          values, so switching back and forth loses nothing. */}
      {profile.kind === "exam" ? (
        <ConfigItem
          id="learning-mode-profile-exam"
          title={i18n.t("learningMode.profile.exam")}
          description={i18n.t("learningMode.profile.examDescription")}
        >
          <Select
            items={EXAM_TAGS.map((tag) => ({ value: tag, label: i18n.t(EXAM_TAG_LABEL_KEY[tag]) }))}
            value={profile.exam}
            onValueChange={(value) => {
              const parsedTag = EXAM_TAGS.find((tag) => tag === value)
              if (parsedTag) saveProfile({ exam: parsedTag })
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {EXAM_TAGS.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {i18n.t(EXAM_TAG_LABEL_KEY[tag])}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </ConfigItem>
      ) : null}

      {profile.kind === "cefr" ? (
        <ConfigItem
          id="learning-mode-profile-cefr"
          title={i18n.t("learningMode.profile.cefrLevel")}
          description={i18n.t("learningMode.profile.cefrDescription")}
        >
          <Select
            // CEFR bands are their own labels: `B1` reads the same in every
            // language, and translating it would only invent a second name.
            value={profile.cefrLevel}
            onValueChange={(value) => {
              const parsedLevel = CEFR_LEVELS.find((level) => level === value)
              if (parsedLevel) saveProfile({ cefrLevel: parsedLevel })
            }}
          >
            <SelectTrigger size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              <SelectGroup>
                {CEFR_LEVELS.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </ConfigItem>
      ) : null}

      {profile.kind === "vocabSize" ? (
        <ConfigItem
          id="learning-mode-profile-vocab-size"
          title={i18n.t("learningMode.profile.vocabSize")}
          description={i18n.t("learningMode.profile.vocabSizeDescription", [
            String(MIN_VOCAB_SIZE),
            String(MAX_VOCAB_SIZE),
          ])}
        >
          <VocabSizeInput
            value={profile.vocabSize}
            onValue={(vocabSize) => saveProfile({ vocabSize })}
          />
        </ConfigItem>
      ) : null}
    </ConfigSection>
  )
}

/**
 * Typing a new number means passing through half-written ones — "80" on the way
 * to "8000" — so the draft lives here and only reaches the config once it is in
 * range. Leaving the field with something unusable in it says so and puts the
 * last good value back.
 */
function VocabSizeInput({ value, onValue }: { value: number; onValue: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  const [prevValue, setPrevValue] = useState(value)

  // Reset the draft when the config value changes from somewhere else.
  if (prevValue !== value) {
    setPrevValue(value)
    setDraft(String(value))
  }

  return (
    <Input
      className="w-28 shrink-0"
      type="number"
      min={MIN_VOCAB_SIZE}
      max={MAX_VOCAB_SIZE}
      step={500}
      value={draft}
      onChange={(e) => {
        const rawValue = e.target.value
        setDraft(rawValue)
        const nextValue = Number(rawValue)
        if (rawValue !== "" && nextValue >= MIN_VOCAB_SIZE && nextValue <= MAX_VOCAB_SIZE) {
          onValue(nextValue)
        }
      }}
      onBlur={() => {
        const nextValue = Number(draft)
        if (draft !== "" && nextValue >= MIN_VOCAB_SIZE && nextValue <= MAX_VOCAB_SIZE) {
          // Drops the leading zeros a typed number can carry: 08000 → 8000.
          setDraft(String(nextValue))
          return
        }
        toastManager.add({
          type: "error",
          title: i18n.t("learningMode.profile.vocabSizeError", [
            String(MIN_VOCAB_SIZE),
            String(MAX_VOCAB_SIZE),
          ]),
        })
        setDraft(String(value))
      }}
    />
  )
}
