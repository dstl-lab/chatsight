import type { LabelDefinition, OrphanedMessage } from '../../types'

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
}

export function ArchiveReviewSidebar({
  orphanedMessages, completedMessageKeys,
  selectedChatlogId, selectedMessageIndex, onSelectMessage,
  labels, archivedLabelId, appliedLabelIds, onToggleLabel,
  onCreateAndApply,
}: Props) {
  const remaining = orphanedMessages.filter(
    m => !completedMessageKeys.has(`${m.chatlog_id}-${m.message_index}`)
  )

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
            return (
              <button
                key={label.id}
                onClick={() => !isArchived && onToggleLabel(label.id)}
                disabled={isArchived}
                className={`w-full text-left rounded px-2.5 py-1.5 text-[11px] transition-colors ${
                  isArchived
                    ? 'bg-neutral-800 border border-neutral-700 text-neutral-600 line-through cursor-not-allowed'
                    : isApplied
                      ? 'bg-blue-900/50 border border-blue-500 text-blue-200'
                      : 'bg-neutral-900 border border-neutral-700 text-neutral-200 hover:bg-neutral-800 hover:border-blue-600'
                }`}
              >
                <span className="truncate">{label.name}</span>
              </button>
            )
          })}
          <button
            onClick={() => {
              const name = prompt('New label name:')
              if (name?.trim()) onCreateAndApply(name.trim())
            }}
            className="w-full text-left bg-transparent border border-dashed border-neutral-700 rounded px-2.5 py-1.5 text-[11px] text-blue-400 hover:border-blue-500 transition-colors"
          >
            + New label
          </button>
        </div>
      </div>
    </aside>
  )
}
