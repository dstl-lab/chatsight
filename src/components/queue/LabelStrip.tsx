import type { LabelDefinition } from '../../types'

interface Props {
  labels: LabelDefinition[]
}

export function LabelStrip({ labels }: Props) {
  if (labels.length === 0) return null

  return (
    <div className="border-t border-neutral-800 px-4 py-2 shrink-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[10px] uppercase tracking-widest text-neutral-600">Labels</span>
        {labels.map(label => (
          <span key={label.id} className="text-[11px] text-neutral-500">
            {label.name} <span className="text-neutral-600">{label.count}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
