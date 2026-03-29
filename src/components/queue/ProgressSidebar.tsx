// src/components/queue/ProgressSidebar.tsx
import type { LabelDefinition, LabelingSession } from '../../types'

interface Props {
  session: LabelingSession | null
  labels: LabelDefinition[]
  totalMessages: number
  skippedCount: number
}

export function ProgressSidebar({ session, labels, totalMessages, skippedCount }: Props) {
  const labeled = session?.labeled_count ?? 0
  const pct = totalMessages > 0 ? Math.round((labeled / totalMessages) * 100) : 0

  return (
    <aside className="w-40 shrink-0 border-r border-neutral-800 p-3 flex flex-col gap-4 overflow-y-auto">
      <div>
        <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1">Progress</p>
        <div className="h-1 bg-neutral-800 rounded-full mb-1">
          <div className="h-1 bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-neutral-200">{labeled} / {totalMessages}</p>
        {skippedCount > 0 && (
          <p className="text-[9px] text-neutral-500 italic mt-1">Skipped: {skippedCount}</p>
        )}
      </div>

      <div>
        <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-2">Labels</p>
        <div className="flex flex-col gap-1">
          {labels.map(label => (
            <div key={label.id} className="flex justify-between items-center bg-neutral-900 rounded px-2 py-1">
              <span className="text-[10px] text-neutral-200 truncate" title={label.name}>
                {label.name}
              </span>
              <span className="text-[9px] text-neutral-500 ml-1 shrink-0">{label.count}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}
