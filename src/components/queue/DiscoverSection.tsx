import { useState } from 'react'
import type { ConceptCandidate } from '../../types'

interface Props {
  candidates: ConceptCandidate[]
  aiUnlocked: boolean
  labeledCount: number
  onDiscover: () => void
  onAccept: (id: number, name?: string) => Promise<void>
  onReject: (id: number) => Promise<void>
  discovering: boolean
}

export default function DiscoverSection({
  candidates,
  aiUnlocked,
  labeledCount,
  onDiscover,
  onAccept,
  onReject,
  discovering,
}: Props) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null)

  // Nudge thresholds
  const nudgeThresholds = [30, 50, 80]
  const showNudge = candidates.length === 0 && nudgeThresholds.some(t => labeledCount >= t && labeledCount < t + 5)

  if (!aiUnlocked) return null

  return (
    <div className="mb-3">
      <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-1.5">Discover</p>

      {candidates.length === 0 && (
        <button
          onClick={onDiscover}
          disabled={discovering}
          className="w-full text-xs py-1.5 px-2 rounded border border-dashed border-violet-500/50 text-violet-300 hover:bg-violet-500/10 transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          {discovering ? (
            <span className="flex items-center justify-center gap-1.5">
              <span className="inline-block w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              Discovering...
            </span>
          ) : (
            <>
              ✦ Discover New Labels
              {showNudge && (
                <span className="block text-[10px] text-amber-400 mt-0.5">
                  Some messages may not fit your labels
                </span>
              )}
            </>
          )}
        </button>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {candidates.map(c => (
            <div
              key={c.id}
              className="rounded bg-neutral-800/60 border border-neutral-700/50 p-2 text-xs"
            >
              <div className="flex items-center justify-between gap-1">
                {renaming?.id === c.id ? (
                  <input
                    autoFocus
                    className="flex-1 bg-neutral-900 border border-neutral-600 rounded px-1.5 py-0.5 text-xs text-neutral-100 outline-none focus:border-violet-500"
                    value={renaming.value}
                    onChange={e => setRenaming({ id: c.id, value: e.target.value })}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && renaming.value.trim()) {
                        onAccept(c.id, renaming.value.trim())
                        setRenaming(null)
                      }
                      if (e.key === 'Escape') setRenaming(null)
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <span
                    className="font-medium text-amber-300 truncate cursor-pointer"
                    onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                  >
                    {c.name}
                  </span>
                )}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => onAccept(c.id)}
                    className="p-0.5 rounded hover:bg-green-500/20 text-green-400"
                    title="Accept"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => setRenaming({ id: c.id, value: c.name })}
                    className="p-0.5 rounded hover:bg-amber-500/20 text-amber-400"
                    title="Rename & Accept"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => onReject(c.id)}
                    className="p-0.5 rounded hover:bg-red-500/20 text-red-400"
                    title="Reject"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {expandedId === c.id && (
                <div className="mt-1.5 text-[11px] text-neutral-400">
                  <p className="mb-1">{c.description}</p>
                  {c.example_messages.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      {c.example_messages.map((ex, i) => (
                        <p key={i} className="text-neutral-500 italic truncate">
                          &ldquo;{ex.excerpt}&rdquo;
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          <button
            onClick={onDiscover}
            disabled={discovering}
            className="text-[10px] text-violet-400 hover:text-violet-300 transition-colors disabled:opacity-50"
          >
            {discovering ? 'Discovering...' : '↻ Discover more'}
          </button>
        </div>
      )}
    </div>
  )
}
