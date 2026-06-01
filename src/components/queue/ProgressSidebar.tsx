import { useState, useCallback } from 'react'
import type { LabelDefinition, LabelingSession, QueueStats, UpdateLabelRequest, HistoryItem, ConceptCandidate, RecalibrationStats } from '../../types'
import { NewLabelPopover } from './NewLabelPopover'
import { RecentHistory } from './RecentHistory'
import { LabelContextMenu } from './LabelContextMenu'
import DiscoverSection from './DiscoverSection'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useKeybinds } from '../../hooks/useKeybinds'

interface AutolabelStatus {
  running: boolean
  processed: number
  total: number
  error: string | null
}

interface Props {
  session: LabelingSession | null
  labels: LabelDefinition[]
  stats: QueueStats | null
  skippedCount: number
  appliedLabelIds: Set<number>
  onToggleLabel: (labelId: number) => void
  onCreateAndApply: (name: string, description?: string) => void
  onUpdateLabel: (id: number, body: UpdateLabelRequest) => void
  onStartAutolabel: () => void
  autolabelStatus: AutolabelStatus | null
  remaining: number | null
  history: HistoryItem[]
  onSelectHistoryItem: (item: HistoryItem) => void
  reviewingKey: string | null
  onReorderLabels: (labelIds: number[]) => void
  onDeleteLabel: (labelId: number) => void
  candidates: ConceptCandidate[]
  onDiscover: () => void
  onOpenDiscoverModal: () => void
  discovering: boolean
  recalibration: {
    phase: 'blind' | 'reconcile'
    originalLabelIds: Set<number>
    relabelIds: Set<number>
  } | null
  recalibrationStats: RecalibrationStats | null
  tutorialDisabled?: boolean
}

interface SortableLabelItemProps {
  label: LabelDefinition
  index: number
  isApplied: boolean
  onToggle: () => void
  isEditing: boolean
  editDesc: string
  onHover: (y: number) => void
  onHoverEnd: () => void
  onSetEditDesc: (v: string) => void
  onCancelEditing: () => void
  onSaveDescription: () => void
  onContextMenu: (e: React.MouseEvent) => void
  isRenaming: boolean
  renameValue: string
  onSetRenameValue: (v: string) => void
  onConfirmRename: () => void
  onCancelRename: () => void
  tutorialDisabled?: boolean
}

function SortableLabelItem({
  label, index, isApplied, onToggle,
  isEditing, editDesc,
  onHover, onHoverEnd,
  onSetEditDesc, onCancelEditing, onSaveDescription,
  onContextMenu, isRenaming, renameValue, onSetRenameValue, onConfirmRename, onCancelRename,
  tutorialDisabled,
}: SortableLabelItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: label.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseEnter={e => onHover(e.currentTarget.getBoundingClientRect().top + e.currentTarget.getBoundingClientRect().height / 2)}
      onMouseLeave={onHoverEnd}
      onContextMenu={onContextMenu}
    >
      {isRenaming ? (
        <input
          autoFocus
          value={renameValue}
          onChange={e => onSetRenameValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onConfirmRename()
            if (e.key === 'Escape') onCancelRename()
          }}
          onBlur={onCancelRename}
          className="w-full bg-surface border border-edge-warm rounded-sm px-2.5 py-1.5 text-[11px] text-paper focus:outline-none focus:border-ochre-dim"
        />
      ) : (
        <button
          onClick={onToggle}
          disabled={tutorialDisabled}
          className={`w-full text-left flex items-center rounded-sm px-2.5 py-1.5 font-serif text-[12px] transition-colors ${
            isApplied
              ? 'bg-ochre/10 border border-ochre-dim text-paper'
              : 'bg-surface border border-edge text-on-surface hover:bg-elevated hover:border-ochre-dim/50'
          } ${tutorialDisabled ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <span className="font-serif truncate flex-1">{label.name}</span>
          {index < 9 && (
            <span
              {...attributes}
              {...listeners}
              className="text-[9px] text-disabled shrink-0 ml-2 cursor-grab active:cursor-grabbing select-none tabular-nums"
              onClick={e => e.stopPropagation()}
            >
              {index + 1}
            </span>
          )}
        </button>
      )}

      {/* Inline editing form (only shown when actively editing via context menu) */}
      {isEditing && !isRenaming && (
        <div className="bg-elevated border border-edge rounded-sm p-2.5 mt-1">
          <textarea
            autoFocus
            value={editDesc}
            onChange={e => onSetEditDesc(e.target.value)}
            placeholder="Description..."
            rows={2}
            className="w-full bg-surface border border-edge rounded-sm px-2 py-1.5 text-[11px] text-paper placeholder:text-faint mb-2 focus:outline-none focus:border-ochre-dim resize-none"
          />
          <div className="flex gap-2 justify-end">
            <button onClick={onCancelEditing} className="text-[10px] text-faint hover:text-tertiary">
              Cancel
            </button>
            <button onClick={onSaveDescription} className="text-[10px] text-ochre hover:text-paper">
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ProgressSidebar({
  session: _session, labels, stats, skippedCount,
  appliedLabelIds, onToggleLabel, onCreateAndApply, onUpdateLabel,
  onStartAutolabel, autolabelStatus, remaining, history, onSelectHistoryItem, reviewingKey, onReorderLabels,
  onDeleteLabel, candidates, onDiscover, onOpenDiscoverModal, discovering,
  recalibration, recalibrationStats,
  tutorialDisabled = false,
}: Props) {
  const { keybinds } = useKeybinds()
  const [showPopover, setShowPopover] = useState(false)
  const [hovered, setHovered] = useState<{ id: number; y: number } | null>(null)
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const [contextMenu, setContextMenu] = useState<{ labelId: number; x: number; y: number } | null>(null)
  const [renamingLabelId, setRenamingLabelId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const formatKey = (key: string) => {
    if (key === ' ') return 'Space'
    if (key === 'enter') return 'Enter'
    if (key.startsWith('shift+')) {
      return '⇧' + key.split('+')[1].toUpperCase()
    }
    return key.toUpperCase()
  }

  const handleHover = useCallback((labelId: number, midY: number) => {
    if (editingLabelId === labelId) return
    const clampedY = Math.min(Math.max(midY, 60), window.innerHeight - 100)
    setHovered({ id: labelId, y: clampedY })
  }, [editingLabelId])

  const handleHoverEnd = useCallback((labelId: number) => {
    if (editingLabelId !== labelId) setHovered(null)
  }, [editingLabelId])

  const labeled = stats?.labeled_count ?? 0
  const total = stats?.total_messages ?? 0
  const pct = total > 0 ? Math.round((labeled / total) * 100) : 0

  // Thresholds lowered for the week-scoped study build (small Week-3 pool).
  const suggestThreshold = 10
  const suggestPct = Math.min(100, Math.round((labeled / suggestThreshold) * 100))
  const suggestUnlocked = labeled >= suggestThreshold

  const autolabelThreshold = Math.min(Math.ceil(total * 0.3), 20)
  const autolabelPct = autolabelThreshold > 0 ? Math.min(100, Math.round((labeled / autolabelThreshold) * 100)) : 0
  const autolabelUnlocked = labeled >= autolabelThreshold && autolabelThreshold > 0

  const handleSaveDescription = (labelId: number) => {
    onUpdateLabel(labelId, { description: editDesc })
    setEditingLabelId(null)
    setHovered(null)
  }

  const handleContextMenu = useCallback((labelId: number, e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ labelId, x: e.clientX, y: e.clientY })
  }, [])

  const handleStartRename = useCallback((labelId: number) => {
    const label = labels.find(l => l.id === labelId)
    if (!label) return
    setRenamingLabelId(labelId)
    setRenameValue(label.name)
    setContextMenu(null)
  }, [labels])

  const handleConfirmRename = useCallback((labelId: number) => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== labels.find(l => l.id === labelId)?.name) {
      onUpdateLabel(labelId, { name: trimmed })
    }
    setRenamingLabelId(null)
  }, [renameValue, labels, onUpdateLabel])

  const handleStartDescriptionEdit = useCallback((labelId: number) => {
    const label = labels.find(l => l.id === labelId)
    if (!label) return
    setEditingLabelId(labelId)
    setEditDesc(label.description || '')
    setContextMenu(null)
  }, [labels])

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIdx = labels.findIndex(l => l.id === active.id)
    const newIdx = labels.findIndex(l => l.id === over.id)
    if (oldIdx === -1 || newIdx === -1) return
    const reordered = [...labels]
    const [moved] = reordered.splice(oldIdx, 1)
    reordered.splice(newIdx, 0, moved)
    onReorderLabels(reordered.map(l => l.id))
  }, [labels, onReorderLabels])

  return (
    <aside className="w-52 shrink-0 border-r border-edge bg-canvas p-4 flex flex-col h-full min-h-0 gap-5">
      <div className="shrink-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint mb-2">Labeled</p>
        <div className="h-1.5 bg-elevated rounded-sm mb-1.5">
          <div className="h-1.5 bg-ochre rounded-sm transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="font-serif text-sm text-paper">{labeled} <span className="text-faint font-normal">/ {total.toLocaleString()}</span></p>
        {skippedCount > 0 && (
          <p className="text-[10px] text-faint mt-1">Skipped: {skippedCount}</p>
        )}
        {remaining !== null && (
          <p className="text-[10px] text-faint mt-1">Remaining: {remaining.toLocaleString()}</p>
        )}
      </div>

      <div className="shrink-0 flex flex-col gap-3" data-tutorial="ai-milestones">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint mb-1.5">AI suggestions</p>
          {suggestUnlocked ? (
            <p className="text-[10px] text-ochre">Active</p>
          ) : (
            <>
              <div className="h-1 bg-elevated rounded-full mb-1">
                <div className="h-1 bg-warning rounded-full transition-all" style={{ width: `${suggestPct}%` }} />
              </div>
              <p className="text-[10px] text-muted">{labeled} / {suggestThreshold} to unlock</p>
            </>
          )}
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint mb-1.5">Auto-labeling</p>
          {autolabelStatus?.running ? (
            <>
              <div className="h-1 bg-elevated rounded-full mb-1">
                <div
                  className="h-1 bg-ochre rounded-full transition-all"
                  style={{ width: `${autolabelStatus.total > 0 ? Math.round((autolabelStatus.processed / autolabelStatus.total) * 100) : 0}%` }}
                />
              </div>
              <p className="text-[10px] text-ochre">
                Labeling... {autolabelStatus.processed.toLocaleString()} / {autolabelStatus.total.toLocaleString()}
              </p>
            </>
          ) : autolabelUnlocked ? (
            <>
              <button
                onClick={onStartAutolabel}
                className="w-full font-mono text-[10px] border border-ochre bg-ochre text-bg-warm rounded-sm px-2 py-1.5 hover:brightness-110 transition-all"
              >
                Auto-label {(total - labeled).toLocaleString()} remaining
              </button>
              {autolabelStatus?.error && (
                <p className="text-[10px] text-danger-text mt-1">{autolabelStatus.error}</p>
              )}
            </>
          ) : (
            <>
              <div className="h-1 bg-elevated rounded-full mb-1">
                <div className="h-1 bg-ochre/50 rounded-full transition-all" style={{ width: `${autolabelPct}%` }} />
              </div>
              <p className="text-[10px] text-muted">{labeled} / {autolabelThreshold} to unlock</p>
            </>
          )}
        </div>
      </div>

      <div className="shrink-0">
        <DiscoverSection
          candidates={candidates}
          aiUnlocked={(stats?.labeled_count ?? 0) >= 10}
          labeledCount={stats?.labeled_count ?? 0}
          onDiscover={onDiscover}
          onOpenModal={onOpenDiscoverModal}
          discovering={discovering}
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden" data-tutorial="label-list">
        <p className="text-[10px] uppercase tracking-widest text-faint mb-2">
          {recalibration?.phase === 'reconcile' ? 'Reconcile Labels' : 'Labels'}
        </p>
        {recalibration?.phase === 'reconcile' && (
          <p className="text-[10px] text-disabled mb-2">Toggle with 1-9 keys, {formatKey(keybinds.yes)} to confirm</p>
        )}
        <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 min-h-0">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={labels.map(l => l.id)} strategy={verticalListSortingStrategy}>
              {labels.map((label, idx) => {
                // Compute diff badge for reconciliation phase
                let diffBadge: { text: string; color: string } | null = null
                if (recalibration?.phase === 'reconcile') {
                  const wasOriginal = recalibration.originalLabelIds.has(label.id)
                  const wasRelabeled = recalibration.relabelIds.has(label.id)
                  if (wasOriginal && wasRelabeled) {
                    diffBadge = { text: 'MATCH', color: 'text-success' }
                  } else if (wasOriginal && !wasRelabeled) {
                    diffBadge = { text: 'WAS ON', color: 'text-danger-text' }
                  } else if (!wasOriginal && wasRelabeled) {
                    diffBadge = { text: 'NEW', color: 'text-ochre' }
                  }
                }

                return (
                  <div key={label.id}>
                    <SortableLabelItem
                      label={label}
                      index={idx}
                      isApplied={appliedLabelIds.has(label.id)}
                      onToggle={() => onToggleLabel(label.id)}
                      isEditing={editingLabelId === label.id}
                      editDesc={editDesc}
                      onHover={y => handleHover(label.id, y)}
                      onHoverEnd={() => handleHoverEnd(label.id)}
                      onSetEditDesc={setEditDesc}
                      onCancelEditing={() => { setEditingLabelId(null); setHovered(null) }}
                      onSaveDescription={() => handleSaveDescription(label.id)}
                      onContextMenu={(e) => handleContextMenu(label.id, e)}
                      isRenaming={renamingLabelId === label.id}
                      renameValue={renameValue}
                      onSetRenameValue={setRenameValue}
                      onConfirmRename={() => handleConfirmRename(label.id)}
                      onCancelRename={() => setRenamingLabelId(null)}
                      tutorialDisabled={tutorialDisabled}
                    />
                    {diffBadge && (
                      <span className={`text-[9px] font-semibold tracking-wider ml-2.5 ${diffBadge.color}`}>
                        {diffBadge.text}
                      </span>
                    )}
                  </div>
                )
              })}
            </SortableContext>
          </DndContext>
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
              disabled={tutorialDisabled}
              className={`w-full text-left bg-transparent border border-dashed border-edge rounded-sm px-2.5 py-1.5 text-[11px] text-muted hover:border-ochre-dim hover:text-ochre transition-colors ${tutorialDisabled ? 'opacity-50 pointer-events-none' : ''}`}
            >
              + New label
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 flex flex-col gap-3">
        <RecentHistory items={history} onSelect={onSelectHistoryItem} reviewingKey={reviewingKey} />
        {recalibrationStats && recalibrationStats.total_recalibrations > 0 && (
          <div className="border-t border-edge-subtle pt-3">
          <p className="text-[10px] uppercase tracking-widest text-disabled mb-2">Calibration</p>
          <div className="flex items-center gap-2">
            <span className={`text-sm ${
              recalibrationStats.trend === 'improving' ? 'text-success' :
              recalibrationStats.trend === 'shifting' ? 'text-warning' :
              'text-muted'
            }`}>
              {recalibrationStats.trend === 'improving' ? '↗' :
               recalibrationStats.trend === 'shifting' ? '↘' : '→'}
            </span>
            <div>
              <p className={`text-[11px] ${
                recalibrationStats.trend === 'improving' ? 'text-tertiary' :
                recalibrationStats.trend === 'shifting' ? 'text-tertiary' :
                'text-muted'
              }`}>
                {recalibrationStats.trend === 'improving' ? 'Improving' :
                 recalibrationStats.trend === 'shifting' ? 'Shifting' : 'Steady'}
              </p>
              <div className="flex gap-px mt-1" aria-label="Calibration sparkline">
                {recalibrationStats.recent_results.map((matched, i) => (
                  <span
                    key={i}
                    className={matched
                      ? recalibrationStats.trend === 'improving' ? 'text-success' :
                        recalibrationStats.trend === 'shifting' ? 'text-warning' : 'text-muted'
                      : 'text-disabled'
                    }
                    style={{ fontSize: '11px', lineHeight: 1 }}
                  >
                    {matched ? '▇' : '▁'}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}
      </div>
      {contextMenu && (
        <LabelContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          labelName={labels.find(l => l.id === contextMenu.labelId)?.name ?? ''}
          onRename={() => handleStartRename(contextMenu.labelId)}
          onEditDescription={() => handleStartDescriptionEdit(contextMenu.labelId)}
          onDelete={() => { onDeleteLabel(contextMenu.labelId); setContextMenu(null) }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Floating description tooltip — renders to the right of the sidebar, no layout reflow */}
      {hovered && !editingLabelId && (() => {
        const label = labels.find(l => l.id === hovered.id)
        if (!label) return null
        return (
          <div
            style={{ top: hovered.y, left: '13.5rem', transform: 'translateY(-50%)' }}
            className="fixed z-50 w-60 bg-elevated border border-edge-strong rounded-lg px-3 py-2.5 shadow-xl pointer-events-none"
          >
            <p className="text-[11px] font-medium text-on-surface mb-1 truncate">{label.name}</p>
            <p className="text-[10px] text-faint mb-1.5">{label.count} labeled</p>
            <p className="text-[11px] text-muted leading-relaxed">
              {label.description || <span className="italic text-disabled">No description — right-click to add one</span>}
            </p>
          </div>
        )
      })()}
    </aside>
  )
}
