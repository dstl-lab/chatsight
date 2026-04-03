import { useState, useRef, useCallback } from 'react'
import type { LabelDefinition, OrphanedMessage, UpdateLabelRequest } from '../../types'
import { NewLabelPopover } from './NewLabelPopover'
import { LabelContextMenu } from './LabelContextMenu'

interface Props {
  orphanedMessages: OrphanedMessage[]
  completedMessageKeys: Set<string>
  selectedChatlogId: number | null
  selectedMessageIndex: number | null
  onSelectMessage: (chatlogId: number, messageIndex: number) => void
  labels: LabelDefinition[]
  archivedLabelId: number
  appliedLabelIds: Set<number>
  onToggleLabel: (labelId: number) => void
  onCreateAndApply: (name: string, description?: string) => void
  onUpdateLabel: (id: number, body: UpdateLabelRequest) => void
}

export function ArchiveReviewSidebar({
  orphanedMessages, completedMessageKeys,
  selectedChatlogId, selectedMessageIndex, onSelectMessage,
  labels, archivedLabelId, appliedLabelIds, onToggleLabel,
  onCreateAndApply, onUpdateLabel,
}: Props) {
  const [showPopover, setShowPopover] = useState(false)
  const [hoveredLabelId, setHoveredLabelId] = useState<number | null>(null)
  const [editingLabelId, setEditingLabelId] = useState<number | null>(null)
  const [editDesc, setEditDesc] = useState('')
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contextMenu, setContextMenu] = useState<{ labelId: number; x: number; y: number } | null>(null)
  const [renamingLabelId, setRenamingLabelId] = useState<number | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const remaining = orphanedMessages.filter(
    m => !completedMessageKeys.has(`${m.chatlog_id}-${m.message_index}`)
  )

  // Filter out archived label for indexing (shortcuts skip the archived label)
  const activeLabels = labels.filter(l => l.id !== archivedLabelId)

  const startHover = useCallback((labelId: number) => {
    if (editingLabelId === labelId) return
    hoverTimer.current = setTimeout(() => setHoveredLabelId(labelId), 750)
  }, [editingLabelId])

  const cancelHover = useCallback((labelId: number) => {
    if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null }
    if (editingLabelId !== labelId) setHoveredLabelId(null)
  }, [editingLabelId])

  const handleContextMenu = useCallback((labelId: number, e: React.MouseEvent) => {
    e.preventDefault()
    if (labelId === archivedLabelId) return
    setContextMenu({ labelId, x: e.clientX, y: e.clientY })
  }, [archivedLabelId])

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

  const handleSaveDescription = (labelId: number) => {
    onUpdateLabel(labelId, { description: editDesc })
    setEditingLabelId(null)
    setHoveredLabelId(null)
  }

  return (
    <aside className="w-52 shrink-0 border-r border-neutral-800 flex flex-col overflow-y-auto">
      {/* Message list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="px-4 pt-4 pb-2">
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-1">
            {remaining.length} of {orphanedMessages.length} to relabel
          </p>
        </div>
        <div className="flex flex-col">
          {orphanedMessages.map(msg => {
            const key = `${msg.chatlog_id}-${msg.message_index}`
            const isSelected = msg.chatlog_id === selectedChatlogId && msg.message_index === selectedMessageIndex
            const isComplete = completedMessageKeys.has(key)
            return (
              <button
                key={key}
                onClick={() => onSelectMessage(msg.chatlog_id, msg.message_index)}
                className={`text-left px-4 py-2.5 border-b border-neutral-800 transition-colors ${
                  isSelected ? 'bg-neutral-900/80 border-l-2 border-l-blue-500' : 'border-l-2 border-l-transparent hover:bg-neutral-900/40'
                } ${isComplete ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-neutral-200 font-medium">
                    {isComplete && <span className="text-green-400 mr-1">&#10003;</span>}
                    Conv #{msg.chatlog_id}
                  </span>
                  <span className="text-[9px] bg-neutral-800 text-neutral-500 px-1.5 py-0.5 rounded-full">
                    msg {msg.message_index}
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 truncate">{msg.preview_text}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Label buttons at bottom */}
      <div className="border-t border-neutral-800 p-4">
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Labels</p>
        <div className="flex flex-col gap-1.5">
          {labels.map(label => {
            const isArchived = label.id === archivedLabelId
            const isApplied = appliedLabelIds.has(label.id)
            const isHovered = hoveredLabelId === label.id
            const isEditing = editingLabelId === label.id
            const isRenaming = renamingLabelId === label.id
            const activeIdx = activeLabels.findIndex(l => l.id === label.id)

            return (
              <div
                key={label.id}
                onMouseEnter={() => !isArchived && startHover(label.id)}
                onMouseLeave={() => cancelHover(label.id)}
                onContextMenu={(e) => handleContextMenu(label.id, e)}
              >
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleConfirmRename(label.id)
                      if (e.key === 'Escape') setRenamingLabelId(null)
                    }}
                    onBlur={() => setRenamingLabelId(null)}
                    className="w-full bg-neutral-900 border border-blue-500 rounded px-2.5 py-1.5 text-[11px] text-neutral-100 focus:outline-none"
                  />
                ) : (
                  <button
                    onClick={() => !isArchived && onToggleLabel(label.id)}
                    disabled={isArchived}
                    className={`w-full text-left flex items-center rounded px-2.5 py-1.5 text-[11px] transition-colors ${
                      isArchived
                        ? 'bg-neutral-800 border border-neutral-700 text-neutral-600 line-through cursor-not-allowed'
                        : isApplied
                          ? 'bg-blue-900/50 border border-blue-500 text-blue-200'
                          : 'bg-neutral-900 border border-neutral-700 text-neutral-200 hover:bg-neutral-800 hover:border-blue-600'
                    }`}
                  >
                    <span className="truncate flex-1">{label.name}</span>
                    {!isArchived && activeIdx < 9 && (
                      <span className="text-[9px] text-neutral-600 shrink-0 ml-2 select-none tabular-nums">
                        {activeIdx + 1}
                      </span>
                    )}
                  </button>
                )}

                {(isHovered || isEditing) && !isRenaming && !isArchived && (
                  <div
                    className="bg-neutral-800 border border-neutral-700 rounded-lg p-2.5 mt-1"
                    onMouseEnter={() => { if (hoverTimer.current) { clearTimeout(hoverTimer.current); hoverTimer.current = null } }}
                    onMouseLeave={() => cancelHover(label.id)}
                  >
                    {isEditing ? (
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
                          <button onClick={() => { setEditingLabelId(null); setHoveredLabelId(null) }} className="text-[10px] text-neutral-500 hover:text-neutral-300">
                            Cancel
                          </button>
                          <button onClick={() => handleSaveDescription(label.id)} className="text-[10px] text-blue-400 hover:text-blue-300">
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
          })}
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
      {contextMenu && (
        <LabelContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          labelName={labels.find(l => l.id === contextMenu.labelId)?.name ?? ''}
          onRename={() => handleStartRename(contextMenu.labelId)}
          onEditDescription={() => handleStartDescriptionEdit(contextMenu.labelId)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </aside>
  )
}
