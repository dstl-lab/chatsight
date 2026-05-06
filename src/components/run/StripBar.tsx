import { useState } from 'react'
import type { SingleLabel, ReadinessState, AssignmentMapping, UnmappedCount } from '../../types'
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
}: StripBarProps) {
  return (
    <div className="flex items-center gap-[18px] px-12 pt-[14px] pb-2 text-muted text-[13px]">
      <span className="font-serif font-medium text-[18px] text-paper tracking-[-0.01em] flex items-center gap-2.5">
        <span className="text-ochre text-[11px]">◆</span>
        {label.name}
      </span>
      <span className="flex-1" />
      <button className="inline-flex items-center gap-2 px-[11px] py-[5px] rounded-full font-mono text-[11px] tracking-[0.04em] text-muted hover:text-on-canvas transition-colors">
        <span className="text-on-surface">{label.yes_count + label.no_count + label.skip_count}</span>
        <span className="opacity-50">/</span>
        <span>{label.total_conversations * 3 || 35}</span>
      </button>
      <AssignmentPicker
        assignments={assignments}
        unmapped={unmapped}
        selectedId={selectedAssignmentId}
        onSelect={onSelectAssignment}
      />
      {import.meta.env.DEV && onSampleHandoff && (
        <SampleHandoffControl onSubmit={onSampleHandoff} />
      )}
      <ReadinessChip readiness={readiness} onHandoff={onHandoff} />
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
