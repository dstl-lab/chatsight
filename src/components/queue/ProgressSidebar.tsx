import { useState, useRef, useCallback } from 'react'
import type { LabelDefinition, LabelingSession, QueueStats, UpdateLabelRequest, HistoryItem, ConceptCandidate } from '../../types'
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
          className="w-full bg-neutral-900 border border-blue-500 rounded px-2.5 py-1.5 text-[11px] text-neutral-100 focus:outline-none"
        />
      ) : (
        <button
          onClick={onToggle}
          className={`w-full text-left flex items-center rounded px-2.5 py-1.5 text-[11px] transition-colors ${
            isApplied
              ? 'bg-blue-900/50 border border-blue-500 text-blue-200'
              : 'bg-neutral-900 border border-neutral-700 text-neutral-200 hover:bg-neutral-800 hover:border-blue-600'
          }`}
        >
          <span className="truncate flex-1">{label.name}</span>
          {index < 9 && (
            <span
              {...attributes}
              {...listeners}
              className="text-[9px] text-neutral-600 shrink-0 ml-2 cursor-grab active:cursor-grabbing select-none tabular-nums"
              onClick={e => e.stopPropagation()}
            >
              {index + 1}
            </span>
          )}
        </button>
      )}

      {(isHovered || isEditing) && !isRenaming && (
        <div
          className="bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 mt-1"
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
                className="w-full bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 text-[11px] text-neutral-100 placeholder-neutral-600 mb-2 focus:outline-none focus:border-blue-600 resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={onCancelEditing} className="text-[10px] text-neutral-500 hover:text-neutral-300">
                  Cancel
                </button>
                <button onClick={onSaveDescription} className="text-[10px] text-blue-400 hover:text-blue-300">
                  Save
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] text-neutral-500 mb-1.5">{label.count} labeled</p>
              <p className="text-[11px] text-neutral-400 leading-relaxed">
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
        {remaining !== null && (
          <p className="text-[10px] text-neutral-500 mt-1">Remaining: {remaining.toLocaleString()}</p>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-1.5">AI suggestions</p>
          {suggestUnlocked ? (
            <p className="text-[10px] text-green-400">Active</p>
          ) : (
            <>
              <div className="h-1 bg-neutral-800 rounded-full mb-1">
                <div className="h-1 bg-amber-500/70 rounded-full transition-all" style={{ width: `${suggestPct}%` }} />
              </div>
              <p className="text-[10px] text-neutral-400">{labeled} / {suggestThreshold} to unlock</p>
            </>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-1.5">Auto-labeling</p>
          {autolabelStatus?.running ? (
            <>
              <div className="h-1 bg-neutral-800 rounded-full mb-1">
                <div
                  className="h-1 bg-purple-500 rounded-full transition-all"
                  style={{ width: `${autolabelStatus.total > 0 ? Math.round((autolabelStatus.processed / autolabelStatus.total) * 100) : 0}%` }}
                />
              </div>
              <p className="text-[10px] text-purple-300">
                Labeling... {autolabelStatus.processed.toLocaleString()} / {autolabelStatus.total.toLocaleString()}
              </p>
            </>
          ) : autolabelUnlocked ? (
            <>
              <button
                onClick={onStartAutolabel}
                className="w-full text-[10px] bg-purple-600 text-white rounded px-2 py-1.5 hover:bg-purple-500 transition-colors"
              >
                Auto-label {(total - labeled).toLocaleString()} remaining
              </button>
              {autolabelStatus?.error && (
                <p className="text-[10px] text-red-400 mt-1">{autolabelStatus.error}</p>
              )}
            </>
          ) : (
            <>
              <div className="h-1 bg-neutral-800 rounded-full mb-1">
                <div className="h-1 bg-purple-500/50 rounded-full transition-all" style={{ width: `${autolabelPct}%` }} />
              </div>
              <p className="text-[10px] text-neutral-400">{labeled} / {autolabelThreshold} to unlock</p>
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
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Labels</p>
        <div className="flex flex-col gap-1.5 overflow-y-auto flex-1 min-h-0">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={labels.map(l => l.id)} strategy={verticalListSortingStrategy}>
              {labels.map((label, idx) => (
                <SortableLabelItem
                  key={label.id}
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
              ))}
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
              className="w-full text-left bg-transparent border border-dashed border-neutral-700 rounded px-2.5 py-1.5 text-[11px] text-blue-400 hover:border-blue-500 transition-colors"
            >
              + New label
            </button>
          )}
        </div>
      </div>
      <RecentHistory items={history} onSelect={onSelectHistoryItem} reviewingKey={reviewingKey} />
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
