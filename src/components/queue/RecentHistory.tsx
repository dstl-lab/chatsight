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
    <div className="border-t border-neutral-800 pt-3 mt-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between text-[10px] uppercase tracking-widest text-neutral-500 mb-2 hover:text-neutral-400"
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
                    ? 'bg-blue-900/40 border border-blue-600'
                    : isSkipped
                      ? 'bg-neutral-900 border-l-2 border-amber-600/50 border-y border-r border-y-neutral-800 border-r-neutral-800'
                      : 'bg-neutral-900 border border-neutral-800 hover:border-neutral-600'
                }`}
              >
                <p className="text-[10px] text-neutral-300 truncate">
                  {item.message_text.length > 50
                    ? item.message_text.slice(0, 50) + '\u2026'
                    : item.message_text}
                </p>
                <p className={`text-[9px] mt-0.5 ${isSkipped ? 'text-amber-500/70' : 'text-neutral-500'}`}>
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
