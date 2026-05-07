import { useState, useEffect } from 'react'
import type { SingleLabel, ReadinessState, AssignmentMapping, UnmappedCount } from '../../types'
import { api } from '../../services/api'
import { AssignmentPicker } from './AssignmentPicker'
import { ReadinessChip } from './ReadinessChip'

interface StripBarProps {
  label: SingleLabel
  readiness: ReadinessState
  assignments: AssignmentMapping[]
  unmapped: UnmappedCount | null
  selectedAssignmentId: number | null
  onSelectAssignment: (id: number | null) => void
  onHandoff: () => void
  onSampleHandoff?: (n: number) => void
  onAbort: () => void
  /** After PATCH explore rate, refetch active label */
  onLabelMetaUpdated?: () => void | Promise<void>
}

export function StripBar({
  label,
  readiness,
  assignments,
  unmapped,
  selectedAssignmentId,
  onSelectAssignment,
  onHandoff,
  onSampleHandoff,
  onAbort,
  onLabelMetaUpdated,
}: StripBarProps) {
  return (
    <div className="flex items-center gap-[18px] px-12 pt-[14px] pb-2 text-muted text-[13px]">
      <span className="font-serif font-medium text-[18px] text-paper tracking-[-0.01em] flex items-center gap-2.5">
        <span className="text-ochre text-[11px]">◆</span>
        {label.name}
      </span>
      <span className="flex-1" />
      <span className="inline-flex items-baseline gap-1.5 px-[11px] py-[5px] font-mono text-[11px] tracking-[0.04em] text-muted">
        <span className="text-on-surface">{label.yes_count + label.no_count}</span>
        <span className="opacity-50 text-[11px]">labels</span>
        <span className="opacity-40 mx-1.5">·</span>
        <span className="text-moss">{label.yes_count}</span>
        <span className="text-faint text-[9px] tracking-[0.14em] uppercase">yes</span>
        <span className="opacity-40 mx-1.5">·</span>
        <span className="text-brick">{label.no_count}</span>
        <span className="text-faint text-[9px] tracking-[0.14em] uppercase">no</span>
      </span>
      <AssignmentPicker
        assignments={assignments}
        unmapped={unmapped}
        selectedId={selectedAssignmentId}
        onSelect={onSelectAssignment}
      />
      {onLabelMetaUpdated && (
        <HybridExploreMix label={label} onSaved={onLabelMetaUpdated} />
      )}
      {import.meta.env.DEV && onSampleHandoff && (
        <SampleHandoffControl onSubmit={onSampleHandoff} />
      )}
      <ReadinessChip readiness={readiness} onHandoff={onHandoff} />
      <button
        type="button"
        onClick={onAbort}
        title="Abort labeling — discard all decisions for this label"
        className="appearance-none font-mono text-[10px] tracking-[0.06em] uppercase text-faint hover:text-brick transition-colors px-2 py-[5px]"
      >
        ✕ abort
      </button>
    </div>
  )
}

function HybridExploreMix({
  label,
  onSaved,
}: {
  label: SingleLabel
  onSaved: () => void | Promise<void>
}) {
  const [pct, setPct] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPct(Math.round(label.hybrid_explore_effective * 100))
  }, [label.hybrid_explore_effective, label.id])

  const apply = async () => {
    const v = Math.max(0, Math.min(100, pct)) / 100
    setBusy(true)
    try {
      await api.patchSingleLabel(label.id, { hybrid_explore_fraction: v })
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  const useDefault = async () => {
    setBusy(true)
    try {
      await api.patchSingleLabel(label.id, { hybrid_explore_fraction: null })
      await onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 shrink-0 max-w-[200px] flex-wrap"
      title="Hybrid queue: this % of picks favor longer conversations (more student messages). The rest samples fairly by assignment. Per-label override; empty uses server default."
    >
      <span className="text-[9px] tracking-[0.06em] uppercase text-faint whitespace-nowrap">
        explore
      </span>
      <input
        type="number"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => setPct(parseInt(e.target.value, 10) || 0)}
        className="w-10 bg-transparent border-b border-edge focus:border-ochre-dim focus:outline-none text-on-surface text-center tabular-nums text-[11px]"
      />
      <span className="text-faint text-[10px]">%</span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void apply()}
        className="text-ochre hover:text-paper text-[10px] disabled:opacity-40"
      >
        set
      </button>
      {label.hybrid_explore_fraction != null && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void useDefault()}
          className="text-faint hover:text-muted text-[10px] disabled:opacity-40"
        >
          default
        </button>
      )}
    </div>
  )
}

function SampleHandoffControl({ onSubmit }: { onSubmit: (n: number) => void }) {
  const [n, setN] = useState(50)
  const valid = Number.isFinite(n) && n > 0
  return (
    <div
      className="inline-flex items-center gap-1.5 pl-2 pr-1 py-[3px] rounded-full border border-dashed border-edge text-[11px] font-mono text-muted"
      title="Dev-only: hand off a random sample of N pending messages"
    >
      <span className="opacity-60 tracking-[0.06em] uppercase text-[9px]">dev</span>
      <input
        type="number"
        min={1}
        value={n}
        onChange={(e) => setN(parseInt(e.target.value, 10) || 0)}
        className="w-12 bg-transparent border-b border-edge focus:border-ochre-dim focus:outline-none text-on-surface text-center tabular-nums"
      />
      <button
        onClick={() => valid && onSubmit(n)}
        disabled={!valid}
        className="px-2 py-[3px] rounded-full text-on-surface hover:text-ochre transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Sample →
      </button>
    </div>
  )
}
