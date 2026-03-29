import { useState } from 'react'
import type { LabelDefinition, LabelingSession, QueueStats } from '../../types'
import { NewLabelPopover } from './NewLabelPopover'

interface Props {
  session: LabelingSession | null
  labels: LabelDefinition[]
  stats: QueueStats | null
  skippedCount: number
  onApply: (labelId: number) => void
  onCreateAndApply: (name: string, description?: string) => void
}

export function ProgressSidebar({ session, labels, stats, skippedCount, onApply, onCreateAndApply }: Props) {
  const [showPopover, setShowPopover] = useState(false)

  const labeled = session?.labeled_count ?? 0
  const total = stats?.total_messages ?? 0
  const pct = total > 0 ? Math.round((labeled / total) * 100) : 0
  const aiThreshold = 50
  const aiPct = Math.min(100, Math.round((labeled / aiThreshold) * 100))
  const aiUnlocked = labeled >= aiThreshold

  return (
    <aside className="w-52 shrink-0 border-r border-neutral-800 p-4 flex flex-col gap-5 overflow-y-auto">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Labeled</p>
        <div className="h-1.5 bg-neutral-800 rounded-full mb-1.5">
          <div className="h-1.5 bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-neutral-200 font-medium">{labeled} <span className="text-neutral-500 font-normal">/ {total.toLocaleString()}</span></p>
        {skippedCount > 0 && (
          <p className="text-[10px] text-neutral-500 mt-1">Skipped: {skippedCount}</p>
        )}
      </div>

      <div>
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">
          {aiUnlocked ? 'AI suggestions active' : 'AI suggestions'}
        </p>
        {aiUnlocked ? (
          <p className="text-[10px] text-green-400">Unlocked</p>
        ) : (
          <>
            <div className="h-1 bg-neutral-800 rounded-full mb-1.5">
              <div className="h-1 bg-amber-500/70 rounded-full transition-all" style={{ width: `${aiPct}%` }} />
            </div>
            <p className="text-[10px] text-neutral-400">{labeled} / {aiThreshold} to unlock</p>
          </>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Apply label</p>
        <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 min-h-0">
          {labels.map(label => (
            <button
              key={label.id}
              onClick={() => onApply(label.id)}
              className="w-full text-left bg-neutral-900 border border-neutral-700 rounded px-2.5 py-1.5 text-[11px] text-neutral-200 hover:bg-neutral-800 hover:border-blue-600 transition-colors truncate"
              title={label.name}
            >
              {label.name}
            </button>
          ))}
          {showPopover ? (
            <NewLabelPopover
              onConfirm={(name, description) => {
                onCreateAndApply(name, description)
                setShowPopover(false)
              }}
              onCancel={() => setShowPopover(false)}
            />
          ) : (
            <button
              onClick={() => setShowPopover(true)}
              className="w-full text-left bg-transparent border border-dashed border-neutral-700 rounded px-2.5 py-1.5 text-[11px] text-blue-400 hover:border-blue-500 transition-colors"
            >
              + New label
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
