import { useState, useRef, useCallback } from 'react'
import type { LabelDefinition, LabelingSession, QueueStats, UpdateLabelRequest, HistoryItem, ConceptCandidate, RecalibrationStats } from '../../types'
import { NewLabelPopover } from './NewLabelPopover'
import { RecentHistory } from './RecentHistory'
import { LabelContextMenu } from './LabelContextMenu'
import DiscoverSection from './DiscoverSection'
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

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
  onArchiveLabel: (labelId: number) => void
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
}

interface SortableLabelItemProps {
  label: LabelDefinition
  index: number
  isApplied: boolean
  onToggle: () => void
  isHovered: boolean
  isEditing: boolean
  editDesc: string
  onStartHover: () => void
  onCancelHover: () => void
  onClearHoverTimer: () => void
  onSetEditDesc: (v: string) => void
  onCancelEditing: () => void
  onSaveDescription: () => void
  onContextMenu: (e: React.MouseEvent) => void
  isRenaming: boolean
  renameValue: string
  onSetRenameValue: (v: string) => void
  onConfirmRename: () => void
  onCancelRename: () => void
}

function SortableLabelItem({
  label, index, isApplied, onToggle,
  isHovered, isEditing, editDesc,
  onStartHover, onCancelHover, onClearHoverTimer,
  onSetEditDesc, onCancelEditing, onSaveDescription,
  onContextMenu, isRenaming, renameValue, onSetRenameValue, onConfirmRename, onCancelRename,
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
      onMouseEnter={onStartHover}
      onMouseLeave={onCancelHover}
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
          className="w-full bg-surface border border-accent-border rounded px-2.5 py-1.5 text-[11px] text-on-canvas focus:outline-none"
        />
      ) : (
        <button
          onClick={onToggle}
          className={`w-full text-left flex items-center rounded px-2.5 py-1.5 text-[11px] transition-colors ${
            isApplied
              ? 'bg-accent-surface border border-accent-border text-accent-on-surface'
              : 'bg-surface border border-edge text-on-surface hover:bg-elevated hover:border-accent'
          }`}
        >
          <span className="truncate flex-1">{label.name}</span>
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

      {(isHovered || isEditing) && !isRenaming && (
        <div
          className="bg-elevated border border-edge rounded-lg p-2.5 mt-1"
          onMouseEnter={onClearHoverTimer}
          onMouseLeave={onCancelHover}
        >
          {isEditing ? (
            <>
              <textarea
                autoFocus
                value={editDesc}
                onChange={e => onSetEditDesc(e.target.value)}
                placeholder="Description..."
                rows={2}
                className="w-full bg-surface border border-edge rounded px-2 py-1.5 text-[11px] text-on-canvas placeholder-disabled mb-2 focus:outline-none focus:border-accent resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={onCancelEditing} className="text-[10px] text-faint hover:text-tertiary">
                  Cancel
                </button>
                <button onClick={onSaveDescription} className="text-[10px] text-accent-text hover:text-accent-on-surface">
                  Save
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] text-faint mb-1.5">{label.count} labeled</p>
              <p className="text-[11px] text-muted leading-relaxed">
                {label.description || 'No description'}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export function ProgressSidebar({
  session: _session, labels, stats, skippedCount,
  appliedLabelIds, onToggleLabel, onCreateAndApply, onUpdateLabel,
  onStartAutolabel, autolabelStatus, remaining, history, onSelectHistoryItem, reviewingKey, onReorderLabels,
  onArchiveLabel, candidates, onDiscover, onOpenDiscoverModal, discovering,
  recalibration, recalibrationStats,
}: Props) {
  const [showPopover, setShowPopover] = useState(false)
  const [hoveredLabelId, setHoveredLabelId] = useState<number | null>(null)
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextMenu, setContextMenu] = useState<{ labelId: number; x: number; y: number } | null>(null)
  const [renamingLabelId, setRenamingLabelId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const startHover = useCallback((labelId: number) => {
    if (editingLabelId === labelId) return
    hoverTimer.current = setTimeout(() => setHoveredLabelId(labelId), 750)
  }, [editingLabelId])

  const cancelHover = useCallback((labelId: number) => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null }
    if (editingLabelId !== labelId) setHoveredLabelId(null)
  }, [editingLabelId])

  const labeled = stats?.labeled_count ?? 0
  const total = stats?.total_messages ?? 0
  const pct = total > 0 ? Math.round((labeled / total) * 100) : 0

  const suggestThreshold = 20
  const suggestPct = Math.min(100, Math.round((labeled / suggestThreshold) * 100))
  const suggestUnlocked = labeled >= suggestThreshold

  const autolabelThreshold = Math.min(Math.ceil(total * 0.4), 100)
  const autolabelPct = autolabelThreshold > 0 ? Math.min(100, Math.round((labeled / autolabelThreshold) * 100)) : 0
  const autolabelUnlocked = labeled >= autolabelThreshold && autolabelThreshold > 0

  const handleSaveDescription = (labelId: number) => {
    onUpdateLabel(labelId, { description: editDesc })
    setEditingLabelId(null)
    setHoveredLabelId(null)
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
    setHoveredLabelId(labelId)
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
    <aside className="w-52 shrink-0 border-r border-edge-subtle p-4 flex flex-col gap-5 overflow-y-auto">
      <div>
        <p className="text-[10px] uppercase tracking-widest text-faint mb-2">Labeled</p>
        <div className="h-1.5 bg-elevated rounded-full mb-1.5">
          <div className="h-1.5 bg-accent rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-sm text-on-surface font-medium">{labeled} <span className="text-faint font-normal">/ {total.toLocaleString()}</span></p>
        {skippedCount > 0 && (
          <p className="text-[10px] text-faint mt-1">Skipped: {skippedCount}</p>
        )}
        {remaining !== null && (
          <p className="text-[10px] text-faint mt-1">Remaining: {remaining.toLocaleString()}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-faint mb-1.5">AI suggestions</p>
          {suggestUnlocked ? (
            <p className="text-[10px] text-success">Active</p>
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
          <p className="text-[10px] uppercase tracking-widest text-faint mb-1.5">Auto-labeling</p>
          {autolabelStatus?.running ? (
            <>
              <div className="h-1 bg-elevated rounded-full mb-1">
                <div
                  className="h-1 bg-purple-500 rounded-full transition-all"
                  style={{ width: `${autolabelStatus.total > 0 ? Math.round((autolabelStatus.processed / autolabelStatus.total) * 100) : 0}%` }}
                />
              </div>
              <p className="text-[10px] text-ai-text">
                Labeling... {autolabelStatus.processed.toLocaleString()} / {autolabelStatus.total.toLocaleString()}
              </p>
            </>
          ) : autolabelUnlocked ? (
            <>
              <button
                onClick={onStartAutolabel}
                className="w-full text-[10px] bg-ai-action text-white rounded px-2 py-1.5 hover:bg-ai-hover transition-colors"
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
                <div className="h-1 bg-purple-500/50 rounded-full transition-all" style={{ width: `${autolabelPct}%` }} />
              </div>
              <p className="text-[10px] text-muted">{labeled} / {autolabelThreshold} to unlock</p>
            </>
          )}
        </div>
      </div>

      <DiscoverSection
        candidates={candidates}
        aiUnlocked={(stats?.labeled_count ?? 0) >= 20}
        labeledCount={stats?.labeled_count ?? 0}
        onDiscover={onDiscover}
        onOpenModal={onOpenDiscoverModal}
        discovering={discovering}
      />

      <div className="flex-1 min-h-0 flex flex-col">
        <p className="text-[10px] uppercase tracking-widest text-faint mb-2">
          {recalibration?.phase === 'reconcile' ? 'Reconcile Labels' : 'Labels'}
        </p>
        {recalibration?.phase === 'reconcile' && (
          <p className="text-[10px] text-disabled mb-2">Toggle with 1-9 keys, Enter to confirm</p>
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
                    diffBadge = { text: 'NEW', color: 'text-accent-text' }
                  }
                }

                return (
                  <div key={label.id}>
                    <SortableLabelItem
                      label={label}
                      index={idx}
                      isApplied={appliedLabelIds.has(label.id)}
                      onToggle={() => onToggleLabel(label.id)}
                      isHovered={hoveredLabelId === label.id}
                      isEditing={editingLabelId === label.id}
                      editDesc={editDesc}
                      onStartHover={() => startHover(label.id)}
                      onCancelHover={() => cancelHover(label.id)}
                      onClearHoverTimer={() => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null } }}
                      onSetEditDesc={setEditDesc}
                      onCancelEditing={() => { setEditingLabelId(null); setHoveredLabelId(null) }}
                      onSaveDescription={() => handleSaveDescription(label.id)}
                      onContextMenu={(e) => handleContextMenu(label.id, e)}
                      isRenaming={renamingLabelId === label.id}
                      renameValue={renameValue}
                      onSetRenameValue={setRenameValue}
                      onConfirmRename={() => handleConfirmRename(label.id)}
                      onCancelRename={() => setRenamingLabelId(null)}
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
              className="w-full text-left bg-transparent border border-dashed border-edge rounded px-2.5 py-1.5 text-[11px] text-accent-text hover:border-accent-border transition-colors"
            >
              + New label
            </button>
          )}
        </div>
      </div>
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
      {contextMenu && (
        <LabelContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          labelName={labels.find(l => l.id === contextMenu.labelId)?.name ?? ''}
          onRename={() => handleStartRename(contextMenu.labelId)}
          onEditDescription={() => handleStartDescriptionEdit(contextMenu.labelId)}
          onArchive={() => { onArchiveLabel(contextMenu.labelId); setContextMenu(null) }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </aside>
  )
}
