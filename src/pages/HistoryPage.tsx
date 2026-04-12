import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { HistoryItem, QueueStats } from '../types'
import { api } from '../services/api'

type Filter = 'all' | 'human' | 'ai' | 'skipped'

export function HistoryPage() {
  const navigate = useNavigate()
  const [items, setItems] = useState<HistoryItem[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<QueueStats | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const limit = 20

  const fetchHistory = useCallback(async () => {
    const sortBy = filter === 'ai' ? 'confidence' : 'processed_at'
    const res = await api.getHistory({
      limit, offset: page * limit, filter, sort_by: sortBy,
      search: search || undefined,
    })
    setItems(res.items)
    setTotal(res.total)
    setLoading(false)
  }, [filter, page, search])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  useEffect(() => {
    api.getQueueStats().then(setStats)
  }, [])

  const handleFilterChange = (f: Filter) => {
    setFilter(f)
    setPage(0)
  }

  const handleClick = (item: HistoryItem) => {
    if (filter === 'skipped') {
      navigate(`/queue?review=${item.chatlog_id}-${item.message_index}&mode=skipped`)
    } else {
      navigate(`/queue?review=${item.chatlog_id}-${item.message_index}`)
    }
  }

  const totalLabeled = stats?.labeled_count ?? 0
  const totalSkipped = stats?.skipped_count ?? 0
  const totalMessages = stats?.total_messages ?? 0
  const remaining = Math.max(0, totalMessages - totalLabeled - totalSkipped)
  const totalPages = Math.ceil(total / limit)

  return (
    <div className="flex-1 flex flex-col min-h-0 p-6 overflow-y-auto">
      {/* Summary cards */}
      <div className="flex gap-3 mb-4">
        {[
          { label: 'Total', value: totalMessages, color: 'text-on-surface' },
          { label: 'Labeled', value: totalLabeled, color: 'text-accent-text' },
          { label: 'Skipped', value: totalSkipped, color: 'text-warning' },
          { label: 'Remaining', value: remaining, color: 'text-faint' },
        ].map(s => (
          <div key={s.label} className="flex-1 bg-surface border border-edge-subtle rounded-lg p-3 text-center">
            <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-[8px] text-faint uppercase tracking-widest mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Progress bar */}
      {totalMessages > 0 && (
        <div className="h-2 bg-elevated rounded-full flex overflow-hidden gap-px mb-4">
          <div className="bg-blue-500 rounded-full" style={{ width: `${(totalLabeled / totalMessages) * 100}%` }} />
          <div className="bg-amber-500 rounded-full" style={{ width: `${(totalSkipped / totalMessages) * 100}%` }} />
        </div>
      )}

      {/* Search + filter tabs */}
      <div className="flex gap-3 mb-4 items-center">
        <input
          type="text"
          placeholder="Search messages..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
          className="flex-1 bg-surface border border-edge-subtle rounded-lg px-3 py-2 text-sm text-on-surface placeholder-disabled focus:outline-none focus:border-accent"
        />
        <div className="flex gap-1">
          {(['all', 'human', 'ai', 'skipped'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => handleFilterChange(f)}
              className={`text-[10px] px-3 py-1.5 rounded-full border transition-colors ${
                filter === f
                  ? 'bg-accent-surface border-accent text-accent-on-surface'
                  : 'border-edge text-faint hover:text-tertiary'
              }`}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* History list */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-faint text-sm">Loading...</div>
      ) : items.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-faint text-sm">No messages found</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {items.map((item, i) => (
            <div
              key={`${item.chatlog_id}-${item.message_index}-${i}`}
              onClick={() => handleClick(item)}
              className="flex items-center gap-2 px-3 py-2 rounded cursor-pointer hover:bg-surface transition-colors group"
            >
              <span className={`text-[7px] rounded px-1.5 py-0.5 uppercase tracking-wide font-semibold shrink-0 ${
                item.applied_by === 'ai' ? 'bg-ai-surface text-ai-text border border-ai-border'
                : item.status === 'skipped' ? 'bg-warning-surface text-warning border border-warning-border'
                : 'bg-accent-surface text-accent-muted border border-accent-border'
              }`}>
                {item.applied_by === 'ai' ? 'AI' : item.status === 'skipped' ? 'S' : 'H'}
              </span>
              <span className="text-sm text-tertiary flex-1 truncate">{item.message_text}</span>
              {item.labels.length > 0 ? (
                <span className="text-[10px] text-disabled shrink-0 max-w-[140px] truncate">{item.labels.join(', ')}</span>
              ) : (
                <span className="text-[10px] text-warning-name shrink-0">&mdash;</span>
              )}
              {item.confidence !== null && (
                <span className="text-[9px] text-disabled tabular-nums shrink-0 w-8 text-right">
                  {Math.round(item.confidence * 100)}%
                </span>
              )}
              <span className="text-[10px] text-disabled group-hover:text-faint shrink-0">&rarr;</span>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-[10px] text-faint">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-2 py-1 border border-edge-subtle rounded disabled:opacity-30"
          >
            &larr; Prev
          </button>
          <span>{page * limit + 1}&ndash;{Math.min((page + 1) * limit, total)} of {total}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page >= totalPages - 1}
            className="px-2 py-1 border border-edge-subtle rounded disabled:opacity-30"
          >
            Next &rarr;
          </button>
        </div>
      )}
    </div>
  )
}
