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
}

export function StripBar({
  label,
  readiness,
  assignments,
  unmapped,
  selectedAssignmentId,
  onSelectAssignment,
  onHandoff,
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
      <ReadinessChip readiness={readiness} onHandoff={onHandoff} />
    </div>
  )
}
