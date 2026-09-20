import type { LearningDictionaryEntry, LearningTier } from "@/utils/learning-mode/types"
import type { WordCardAiResult } from "@/utils/learning-mode/word-card-schema"
import { RiVolumeUpLine } from "@remixicon/react"
import { i18n } from "@/utils/i18n"

/** What the card renders: the mark that was hovered, resolved to its row. */
export interface WordCardData {
  surface: string
  tier: LearningTier
  entry: LearningDictionaryEntry
  sentence: string
}

/**
 * The AI half of the card. `loading` is shown the moment the request starts so
 * the reader sees the card react, and a `null` result reads as "the model had
 * nothing to add" rather than a failure.
 */
export interface WordCardAiState {
  status: "idle" | "loading" | "ready" | "error"
  result?: WordCardAiResult | null
}

/**
 * Each tier's label is resolved through a literal key so the i18n facade can
 * check the substitution contract; an indexed lookup would widen to a union.
 */
const TIER_LABEL: Record<LearningTier, () => string> = {
  tier1: () => i18n.t("learningMode.tier.nudge"),
  tier2: () => i18n.t("learningMode.tier.hard"),
  tier3: () => i18n.t("learningMode.tier.beyond"),
}

const TIER_BADGE_CLASS: Record<LearningTier, string> = {
  tier1: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  tier2: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  tier3: "bg-rose-500/20 text-rose-700 dark:text-rose-300",
}

const CHIP_CLASS =
  "rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground uppercase"

const ACTION_CLASS =
  "rounded-md border border-transparent px-2 py-1 text-xs font-medium transition-colors"
const GHOST_ACTION_CLASS = `${ACTION_CLASS} text-muted-foreground hover:bg-accent hover:text-foreground`
const PRIMARY_ACTION_CLASS = `${ACTION_CLASS} bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60`

/** Rank shown on the card: contemporary corpus first, BNC as the fallback. */
function displayRank(entry: LearningDictionaryEntry): number | undefined {
  return entry.frq ?? entry.bnc
}

function Senses({ entry }: { entry: LearningDictionaryEntry }) {
  const chinese = entry.t?.slice(0, 4) ?? []
  if (chinese.length === 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        {i18n.t("learningMode.card.noDefinition")}
      </p>
    )
  }

  return (
    <div className="mt-2 space-y-1">
      <p className="text-[11px] font-medium text-muted-foreground">
        {i18n.t("learningMode.card.senses")}
      </p>
      <ul className="space-y-0.5 text-sm leading-snug">
        {chinese.map((sense) => (
          <li key={sense}>{sense}</li>
        ))}
      </ul>
    </div>
  )
}

export function WordCard({
  data,
  saved,
  ai,
  onSpeak,
  onSave,
  onKnow,
  onIgnore,
}: {
  data: WordCardData
  saved: boolean
  ai: WordCardAiState
  onSpeak: () => void
  onSave: () => void
  onKnow: () => void
  onIgnore: () => void
}) {
  const rank = displayRank(data.entry)

  return (
    <div className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg">
      <div className="flex items-center gap-2">
        <span className="truncate text-base font-semibold">{data.surface}</span>
        {data.entry.p ? (
          <span className="truncate text-xs text-muted-foreground">/{data.entry.p}/</span>
        ) : null}
        <button
          type="button"
          onClick={onSpeak}
          className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label={data.surface}
        >
          <RiVolumeUpLine className="size-4" />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span
          className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${TIER_BADGE_CLASS[data.tier]}`}
        >
          {TIER_LABEL[data.tier]()}
        </span>
        {data.entry.cefr ? <span className={CHIP_CLASS}>cefr {data.entry.cefr}</span> : null}
        {data.entry.tags?.map((tag) => (
          <span key={tag} className={CHIP_CLASS}>
            {tag}
          </span>
        ))}
        {rank !== undefined ? (
          <span className={CHIP_CLASS}>
            {i18n.t("learningMode.card.frequency")} {rank.toLocaleString()}
          </span>
        ) : null}
        {data.entry.col ? <span className={CHIP_CLASS}>{"★".repeat(data.entry.col)}</span> : null}
      </div>

      <Senses entry={data.entry} />

      {ai.status === "loading" ? (
        <p className="mt-2 animate-pulse text-xs text-muted-foreground">
          {i18n.t("learningMode.card.aiThinking")}
        </p>
      ) : null}

      {ai.status === "error" ? (
        <p className="mt-2 text-xs text-muted-foreground">{i18n.t("learningMode.card.aiFailed")}</p>
      ) : null}

      {ai.status === "ready" && ai.result ? (
        <div className="mt-2 space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">
            {i18n.t("learningMode.card.contextualTitle")}
          </p>
          <p className="text-sm leading-snug">{ai.result.contextual}</p>
          {ai.result.senses.length > 0 ? (
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="font-medium">{i18n.t("learningMode.card.otherSenses")}</span>
              {ai.result.senses.map((sense) => (
                <span key={`${sense.pos}-${sense.meaning}`}>
                  {sense.pos ? `${sense.pos} ` : ""}
                  {sense.meaning}
                </span>
              ))}
            </div>
          ) : null}
          {ai.result.note ? (
            <p className="text-xs text-muted-foreground">{ai.result.note}</p>
          ) : null}
        </div>
      ) : null}

      {data.sentence ? (
        <div className="mt-2 border-l-2 pl-2">
          <p className="text-[11px] font-medium text-muted-foreground">
            {i18n.t("learningMode.card.example")}
          </p>
          <p className="text-xs text-muted-foreground italic">{data.sentence}</p>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-1">
        <button type="button" onClick={onSave} disabled={saved} className={PRIMARY_ACTION_CLASS}>
          {saved
            ? i18n.t("learningMode.card.savedToWordBookHint")
            : i18n.t("learningMode.card.addToWordBook")}
        </button>
        <button type="button" onClick={onKnow} className={GHOST_ACTION_CLASS}>
          {i18n.t("learningMode.card.iKnowThis")}
        </button>
        <button type="button" onClick={onIgnore} className={GHOST_ACTION_CLASS}>
          {i18n.t("learningMode.card.ignore")}
        </button>
      </div>
    </div>
  )
}
