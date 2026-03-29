import type { LabelDefinition, LabelingSession, QueueStats } from '../../types'

interface Props {
  session: LabelingSession | null
  labels: LabelDefinition[]
  stats: QueueStats | null
  skippedCount: number
}

export function ProgressSidebar({ session, labels, stats, skippedCount }: Props) {
  const labeled = session?.labeled_count ?? 0
  const total = stats?.total_messages ?? 0
  const pct = total > 0 ? Math.round((labeled / total) * 100) : 0
  const aiThreshold = 50
  const aiPct = Math.min(100, Math.round((labeled / aiThreshold) * 100))
  const aiUnlocked = labeled >= aiThreshold

  return (
    <aside className="w-48 shrink-0 border-r border-neutral-800 p-4 flex flex-col gap-5 overflow-y-auto">
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

      {labels.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Labels</p>
          <div className="flex flex-col gap-1">
            {labels.map(label => (
              <div key={label.id} className="flex justify-between items-center bg-neutral-900 rounded px-2 py-1">
                <span className="text-[11px] text-neutral-200 truncate" title={label.name}>
                  {label.name}
                </span>
                <span className="text-[10px] text-neutral-500 ml-2 shrink-0">{label.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  )
}
