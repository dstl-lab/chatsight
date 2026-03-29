import { useState, useRef, useCallback } from 'react'
import type { LabelDefinition, LabelingSession, QueueStats, UpdateLabelRequest } from '../../types'
import { NewLabelPopover } from './NewLabelPopover'

interface Props {
  session: LabelingSession | null
  labels: LabelDefinition[]
  stats: QueueStats | null
  skippedCount: number
  appliedLabelIds: Set<number>
  onToggleLabel: (labelId: number) => void
  onCreateAndApply: (name: string, description?: string) => void
  onUpdateLabel: (id: number, body: UpdateLabelRequest) => void
}

export function ProgressSidebar({
  session, labels, stats, skippedCount,
  appliedLabelIds, onToggleLabel, onCreateAndApply, onUpdateLabel,
}: Props) {
  const [showPopover, setShowPopover] = useState(false)
  const [hoveredLabelId, setHoveredLabelId] = useState<number | null>(null)
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startHover = useCallback((labelId: number) => {
    if (editingLabelId === labelId) return
    hoverTimer.current = setTimeout(() => setHoveredLabelId(labelId), 2000)
  }, [editingLabelId])

  const cancelHover = useCallback((labelId: number) => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null }
    if (editingLabelId !== labelId) setHoveredLabelId(null)
  }, [editingLabelId])

  const labeled = session?.labeled_count ?? 0
  const total = stats?.total_messages ?? 0
  const pct = total > 0 ? Math.round((labeled / total) * 100) : 0
  const aiThreshold = 50
  const aiPct = Math.min(100, Math.round((labeled / aiThreshold) * 100))
  const aiUnlocked = labeled >= aiThreshold

  const handleSaveDescription = (labelId: number) => {
    onUpdateLabel(labelId, { description: editDesc })
    setEditingLabelId(null)
    setHoveredLabelId(null)
  }

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
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Labels</p>
        <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 min-h-0">
          {labels.map(label => (
            <div
              key={label.id}
              onMouseEnter={() => startHover(label.id)}
              onMouseLeave={() => cancelHover(label.id)}
            >
              <button
                onClick={() => onToggleLabel(label.id)}
                className={`w-full text-left flex items-center rounded px-2.5 py-1.5 text-[11px] transition-colors ${
                  appliedLabelIds.has(label.id)
                    ? 'bg-blue-900/50 border border-blue-500 text-blue-200'
                    : 'bg-neutral-900 border border-neutral-700 text-neutral-200 hover:bg-neutral-800 hover:border-blue-600'
                }`}
                title={label.name}
              >
                <span className="truncate flex-1">{label.name}</span>
                {label.count > 0 && (
                  <span className="ml-1.5 text-[9px] text-neutral-500 bg-neutral-800 rounded-full px-1.5 shrink-0">
                    {label.count}
                  </span>
                )}
              </button>

              {(hoveredLabelId === label.id || editingLabelId === label.id) && (
                <div
                  className="bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 mt-1"
                  onMouseEnter={() => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null } }}
                  onMouseLeave={() => cancelHover(label.id)}
                >
                  {editingLabelId === label.id ? (
                    <>
                      <textarea
                        autoFocus
                        value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        placeholder="Description..."
                        rows={2}
                        className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-[11px] text-neutral-100 placeholder-neutral-600 mb-2 focus:outline-none focus:border-blue-600 resize-none"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => { setEditingLabelId(null); setHoveredLabelId(null) }}
                          className="text-[10px] text-neutral-500 hover:text-neutral-300"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleSaveDescription(label.id)}
                          className="text-[10px] text-blue-400 hover:text-blue-300"
                        >
                          Save
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-[11px] text-neutral-400 leading-relaxed">
                        {label.description || 'No description'}
                      </p>
                      <button
                        onClick={() => { setEditingLabelId(label.id); setEditDesc(label.description || '') }}
                        className="text-[10px] text-blue-400 mt-1 hover:text-blue-300"
                      >
                        {label.description ? 'Edit' : 'Add description'}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
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
