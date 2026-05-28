import { useEffect, useState } from 'react'
import type { SingleLabel, ReadinessState, AssignmentMapping, UnmappedCount } from '../../types'
import { api } from '../../services/api'
import { AssignmentPicker } from './AssignmentPicker'
import { ReadinessChip } from './ReadinessChip'
import { HoverTip } from './HoverTip'
import { isPlaceholderLabelName } from './labelPlaceholder'

export interface StripBarProps {
  label: SingleLabel
  readiness: ReadinessState
  assignments: AssignmentMapping[]
  unmapped: UnmappedCount | null
  selectedAssignmentId: number | null
  onSelectAssignment: (id: number | null) => void
  onHandoff?: () => void
  onLabelMetaUpdated?: () => void | Promise<void>
  onSampleHandoff?: (n: number) => void
  readinessOpen?: boolean
  onReadinessOpenChange?: (open: boolean) => void
  labelNameDraft?: string
  onLabelNameDraftChange?: (name: string) => void
  onLabelNameCommit?: () => void
  draftMode?: boolean
  onDraftNameCommit?: () => void
  labelNameLocked?: boolean
  queued?: SingleLabel[]
  onNoteAdd?: () => void
  onClearAll?: () => void
  onSwitchQueued?: (id: number) => void
  onRemoveQueued?: (id: number) => void
}

export function StripBar({
  label,
  readiness,
  assignments,
  unmapped,
  selectedAssignmentId,
  onSelectAssignment,
  onHandoff,
  onLabelMetaUpdated,
  onSampleHandoff,
  readinessOpen,
  onReadinessOpenChange,
  labelNameDraft,
  onLabelNameDraftChange,
  onLabelNameCommit,
  draftMode = false,
  onDraftNameCommit,
  labelNameLocked = false,
  queued = [],
  onNoteAdd,
  onClearAll,
  onSwitchQueued,
  onRemoveQueued,
}: StripBarProps) {
  const showNameInput =
    draftMode ||
    (isPlaceholderLabelName(label.name) &&
      labelNameDraft != null &&
      onLabelNameDraftChange != null)

  const commitName = draftMode ? onDraftNameCommit : onLabelNameCommit

  const [explorePct, setExplorePct] = useState(0)
  const [exploreBusy, setExploreBusy] = useState(false)
  const [sampleN, setSampleN] = useState(50)

  useEffect(() => {
    const eff = label.hybrid_explore_effective ?? 0.35
    setExplorePct(Math.round(eff * 100))
  }, [label.hybrid_explore_effective, label.id])

  const applyExplore = async () => {
    if (!onLabelMetaUpdated) return
    const v = Math.max(0, Math.min(100, explorePct)) / 100
    setExploreBusy(true)
    try {
      await api.patchSingleLabel(label.id, { hybrid_explore_fraction: v })
      await onLabelMetaUpdated()
    } finally {
      setExploreBusy(false)
    }
  }

  const resetExploreDefault = async () => {
    if (!onLabelMetaUpdated) return
    setExploreBusy(true)
    try {
      await api.patchSingleLabel(label.id, { hybrid_explore_fraction: null })
      await onLabelMetaUpdated()
    } finally {
      setExploreBusy(false)
    }
  }

  return (
    <div className="relative z-40 border-b border-edge-subtle bg-canvas px-12 py-3.5 text-muted text-[13px]">
      <div className="grid w-full min-w-0 grid-cols-1 gap-y-3 md:grid-cols-2 md:gap-x-10 md:gap-y-2">
        {/* Labels: name, counts, queue, handoff, note */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex min-w-0 max-w-full items-center gap-2.5">
              <span className="text-ochre text-[11px]">◆</span>
              {showNameInput ? (
                <input
                  type="text"
                  data-tutorial="label-name"
                  value={labelNameDraft ?? ''}
                  readOnly={labelNameLocked}
                  onChange={(e) => onLabelNameDraftChange?.(e.target.value)}
                  onKeyDown={(e) => {
                    const name = (labelNameDraft ?? '').trim()
                    if (e.key === 'Enter' && name && !isPlaceholderLabelName(name) && !labelNameLocked) {
                      e.preventDefault()
                      commitName?.()
                    }
                  }}
                  onBlur={() => {
                    if (draftMode || labelNameLocked) return
                    onLabelNameCommit?.()
                  }}
                  placeholder="Label name…"
                  className="box-border w-full min-w-[10rem] max-w-[18rem] rounded-sm border border-edge bg-surface px-2.5 py-1.5 font-sans text-sm text-on-canvas placeholder:text-faint focus:outline-none focus:border-ochre-dim disabled:opacity-70"
                />
              ) : (
                <span className="truncate font-serif text-[20px] font-medium leading-none tracking-[-0.01em] text-paper">
                  {label.name}
                </span>
              )}
            </div>
            <span
              className="inline-flex shrink-0 items-baseline gap-1 font-mono text-[11px] tabular-nums text-muted"
              title="Human yes / no on this label"
            >
              <span className="text-moss">{label.yes_count}</span>
              <span className="text-[9px] uppercase text-faint">y</span>
              <span className="opacity-40">·</span>
              <span className="text-brick">{label.no_count}</span>
              <span className="text-[9px] uppercase text-faint">n</span>
            </span>
            <div className="relative z-50 flex shrink-0 flex-wrap items-center gap-4">
              {!draftMode && onHandoff ? (
                <ReadinessChip
                  readiness={readiness}
                  labelId={label.id}
                  guidance={label.guidance}
                  onHandoff={onHandoff}
                  open={readinessOpen}
                  onOpenChange={onReadinessOpenChange}
                />
              ) : (
                <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-faint">
                  Not ready
                </span>
              )}
              {onNoteAdd && (
                <button
                  type="button"
                  data-tutorial="note-label"
                  onClick={onNoteAdd}
                  className="shrink-0 font-mono text-[11px] tracking-[0.04em] text-muted hover:text-ochre"
                >
                  + note a label{' '}
                  <span className="ml-1 rounded-sm border border-edge px-1.5 py-px text-[9px] text-faint">
                    L
                  </span>
                </button>
              )}
            </div>
          </div>
          <LabelQueueStrip
            queued={queued}
            onSwitch={onSwitchQueued}
            onRemove={onRemoveQueued}
            onClearAll={onClearAll}
          />
        </div>

        {/* Conversations: assignment filter + explore sampling (menu portals) */}
        <div className="relative z-10 min-w-0 md:flex md:justify-end">
          <div className="flex w-max max-w-full flex-wrap items-center gap-6 md:justify-end">
            <AssignmentPicker
              assignments={assignments}
              unmapped={unmapped}
              selectedId={selectedAssignmentId}
              onSelect={onSelectAssignment}
            />
            {!draftMode && onLabelMetaUpdated && (
              <div className="inline-flex items-center gap-2 font-mono text-[11px] text-muted">
                <HoverTip
                  label="new-chat explore"
                  className="text-[9px] tracking-[0.06em] uppercase text-faint"
                  tip={
                    'Percent of new chats picked by Explore (unique, scored threads) versus ' +
                    'round-robin (random fair rotation). In-progress chats are always finished first.'
                  }
                />
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={explorePct}
                  onChange={(e) => setExplorePct(parseInt(e.target.value, 10) || 0)}
                  className="w-10 border-b border-edge bg-transparent text-center tabular-nums text-on-surface focus:border-ochre-dim focus:outline-none"
                />
                <span className="text-faint">%</span>
                <button
                  type="button"
                  disabled={exploreBusy}
                  onClick={() => void applyExplore()}
                  className="text-ochre hover:text-paper disabled:opacity-40"
                >
                  set
                </button>
                {label.hybrid_explore_fraction != null && (
                  <button
                    type="button"
                    disabled={exploreBusy}
                    onClick={() => void resetExploreDefault()}
                    className="text-faint hover:text-muted disabled:opacity-40"
                  >
                    default
                  </button>
                )}
              </div>
            )}
            {!draftMode && import.meta.env.DEV && onSampleHandoff && (
              <div
                className="inline-flex items-center gap-2 rounded-full border border-dashed border-edge px-2.5 py-1 font-mono text-[11px]"
                title="Dev: sample handoff"
              >
                <span className="text-[9px] uppercase tracking-[0.06em] text-faint">dev</span>
                <input
                  type="number"
                  min={1}
                  value={sampleN}
                  onChange={(e) => setSampleN(parseInt(e.target.value, 10) || 0)}
                  className="w-10 border-b border-edge bg-transparent text-center tabular-nums focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!Number.isFinite(sampleN) || sampleN <= 0}
                  onClick={() => onSampleHandoff(sampleN)}
                  className="text-on-surface hover:text-ochre disabled:opacity-40"
                >
                  Sample →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LabelQueueStrip({
  queued,
  onSwitch,
  onRemove,
  onClearAll,
}: {
  queued: SingleLabel[]
  onSwitch?: (id: number) => void
  onRemove?: (id: number) => void
  onClearAll?: () => void
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-serif text-[12px] tracking-[-0.005em] text-faint">
      <span className="shrink-0 font-mono text-[9px] tracking-[0.14em] uppercase text-faint">
        Up next
      </span>
      <span className="min-w-0 flex flex-wrap items-baseline gap-0">
        {queued.length === 0 ? (
          <span className="italic text-faint">— nothing queued —</span>
        ) : (
          queued.map((q, i) => (
            <span key={q.id} className="group inline-flex items-baseline">
              {i > 0 && <span className="mx-1.5 text-faint not-italic">·</span>}
              <button
                type="button"
                onClick={() => onSwitch?.(q.id)}
                disabled={!onSwitch}
                className="border-b border-dashed border-transparent py-0.5 text-on-surface transition-colors hover:border-faint hover:text-on-canvas disabled:cursor-default disabled:opacity-70"
              >
                {q.name}
              </button>
              {onRemove && (
                <button
                  type="button"
                  onClick={() => onRemove(q.id)}
                  title={`Remove "${q.name}" from queue`}
                  aria-label={`Remove ${q.name} from queue`}
                  className="ml-1 text-[11px] leading-none text-faint opacity-0 transition-all not-italic group-hover:opacity-100 hover:text-brick"
                >
                  ✕
                </button>
              )}
            </span>
          ))
        )}
      </span>
      {queued.length > 1 && onClearAll && (
        <button
          type="button"
          onClick={onClearAll}
          className="shrink-0 font-mono text-[9px] tracking-[0.04em] text-faint transition-colors hover:text-brick"
        >
          clear all
        </button>
      )}
    </div>
  )
}
