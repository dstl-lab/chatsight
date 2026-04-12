import { useState } from 'react'
import type { HistoryItem } from '../../types'

interface Props {
  items: HistoryItem[]
  onSelect: (item: HistoryItem) => void
  reviewingKey: string | null
}

export function RecentHistory({ items, onSelect, reviewingKey }: Props) {
  const [open, setOpen] = useState(false)

  if (items.length === 0) return null

  return (
    <div className="border-t border-edge-subtle pt-3 mt-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-[10px] uppercase tracking-widest text-faint mb-2 hover:text-muted"
      >
        <span>Recent</span>
        <span>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5">
          {items.slice(0, 5).map((item, i) => {
            const key = `${item.chatlog_id}-${item.message_index}`
            const isActive = reviewingKey === key
            const isSkipped = item.status === 'skipped'

            return (
              <div
                key={i}
                data-history-item
                onClick={() => onSelect(item)}
                className={`rounded px-2 py-1.5 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-accent-surface border border-accent'
                    : isSkipped
                      ? 'bg-surface border-l-2 border-warning-border border-y border-r border-y-edge-subtle border-r-edge-subtle'
                      : 'bg-surface border border-edge-subtle hover:border-edge-strong'
                }`}
              >
                <p className="text-[10px] text-tertiary truncate">
                  {item.message_text.length > 50
                    ? item.message_text.slice(0, 50) + '\u2026'
                    : item.message_text}
                </p>
                <p className={`text-[9px] mt-0.5 ${isSkipped ? 'text-warning' : 'text-faint'}`}>
                  {isSkipped ? 'Skipped' : item.labels.join(', ')}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
