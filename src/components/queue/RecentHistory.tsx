import { useState } from 'react'
import type { HistoryItem } from '../../types'

interface Props {
  items: HistoryItem[]
}

export function RecentHistory({ items }: Props) {
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
          {items.slice(0, 5).map((item, i) => (
            <div key={i} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1.5">
              <p className="text-[10px] text-neutral-300 truncate">
                {item.message_text.length > 50
                  ? item.message_text.slice(0, 50) + '\u2026'
                  : item.message_text}
              </p>
              <p className="text-[9px] text-neutral-500 mt-0.5">
                {item.labels.join(', ')}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
