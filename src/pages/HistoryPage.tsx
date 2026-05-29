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
    <div className="flex-1 overflow-auto bg-canvas">
      <div className="max-w-[880px] mx-auto px-12 py-12">
        <header className="mb-8">
          <h1 className="font-serif font-medium text-[32px] text-paper tracking-[-0.018em] m-0 mb-1.5">
            History
          </h1>
          <p className="font-serif text-on-surface text-[14px] leading-[1.6] max-w-[600px] m-0">
            Messages you have labeled or skipped in the multi-label queue. Click a row to reopen it in review mode.
          </p>
        </header>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total', value: totalMessages, color: 'text-paper' },
            { label: 'Labeled', value: totalLabeled, color: 'text-ochre' },
            { label: 'Skipped', value: totalSkipped, color: 'text-stone' },
            { label: 'Remaining', value: remaining, color: 'text-faint' },
          ].map(s => (
            <div key={s.label} className="border border-edge rounded-sm bg-bg-warm px-4 py-3 text-center">
              <div className={`font-mono text-[20px] tabular-nums ${s.color}`}>{s.value.toLocaleString()}</div>
              <div className="font-mono text-[9px] text-faint uppercase tracking-[0.14em] mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        {totalMessages > 0 && (
          <div className="h-1.5 bg-elevated rounded-sm flex overflow-hidden gap-px mb-8">
            <div className="bg-ochre" style={{ width: `${(totalLabeled / totalMessages) * 100}%` }} />
            <div className="bg-stone" style={{ width: `${(totalSkipped / totalMessages) * 100}%` }} />
          </div>
        )}

        {/* Search + filter tabs */}
        <div className="flex gap-3 mb-6 items-center">
          <input
            type="text"
            placeholder="Search messages…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="flex-1 bg-surface border border-edge rounded-sm px-3 py-2 font-serif text-[14px] text-paper placeholder:text-faint focus:outline-none focus:border-ochre-dim"
          />
          <div className="flex gap-1.5">
            {(['all', 'human', 'ai', 'skipped'] as Filter[]).map(f => (
              <button
                key={f}
                onClick={() => handleFilterChange(f)}
                className={`font-mono text-[10px] tracking-[0.08em] uppercase px-3 py-1.5 rounded-full border transition-colors ${
                  filter === f
                    ? 'border-ochre-dim bg-elevated text-paper'
                    : 'border-edge text-faint hover:text-on-surface'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* History list */}
        {loading ? (
          <div className="py-16 text-center font-mono text-[10px] tracking-[0.18em] uppercase text-faint animate-pulse">
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center">
            <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-faint mb-2">No messages found</div>
            <div className="font-serif text-on-surface text-[15px]">Try a different filter or search term.</div>
          </div>
        ) : (
          <div className="flex flex-col border border-edge rounded-sm overflow-hidden">
            {items.map((item, i) => (
              <div
                key={`${item.chatlog_id}-${item.message_index}-${i}`}
                onClick={() => handleClick(item)}
                className="flex items-center gap-3 px-4 py-3 border-b border-edge-subtle last:border-b-0 cursor-pointer hover:bg-elevated/60 transition-colors group"
              >
                <span className={`font-mono text-[9px] rounded-sm px-1.5 py-0.5 uppercase tracking-wide shrink-0 ${
                  item.applied_by === 'ai' ? 'bg-ochre text-bg-warm border border-ochre'
                  : item.status === 'skipped' ? 'bg-stone/15 text-stone border border-stone/50'
                  : 'bg-ochre/15 text-ochre border border-ochre-dim'
                }`}>
                  {item.applied_by === 'ai' ? 'AI' : item.status === 'skipped' ? 'S' : 'H'}
                </span>
                {item.message_text?.trim() ? (
                  <span className="font-serif text-[14px] text-on-surface flex-1 truncate">{item.message_text}</span>
                ) : (
                  <span className="font-serif italic text-[14px] text-faint flex-1 truncate">No message text</span>
                )}
                {item.labels.length > 0 ? (
                  <span className="font-mono text-[10px] text-faint shrink-0 max-w-[160px] truncate">{item.labels.join(', ')}</span>
                ) : (
                  <span className="font-mono text-[10px] text-stone shrink-0">&mdash;</span>
                )}
                {item.confidence !== null && (
                  <span className="font-mono text-[9px] text-faint tabular-nums shrink-0 w-8 text-right">
                    {Math.round(item.confidence * 100)}%
                  </span>
                )}
                <span className="font-mono text-[10px] text-faint group-hover:text-muted shrink-0">&rarr;</span>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-4 mt-6 font-mono text-[10px] text-faint tracking-[0.08em]">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 border border-edge rounded-sm disabled:opacity-30 hover:border-ochre-dim transition-colors"
            >
              &larr; Prev
            </button>
            <span>{page * limit + 1}&ndash;{Math.min((page + 1) * limit, total)} of {total}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 border border-edge rounded-sm disabled:opacity-30 hover:border-ochre-dim transition-colors"
            >
              Next &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
