import { useState } from 'react'
import type { ConceptCandidate, LabelDefinition } from '../../types'

interface Props {
  candidates: ConceptCandidate[]
  labels: LabelDefinition[]
  onAccept: (id: number, name?: string) => Promise<void>
  onReject: (id: number) => Promise<void>
  onDiscover: () => void
  onClose: () => void
  discovering: boolean
}

export default function DiscoverModal({
  candidates,
  labels,
  onAccept,
  onReject,
  onDiscover,
  onClose,
  discovering,
}: Props) {
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#16161f] border border-neutral-800 rounded-xl shadow-2xl w-full max-w-[720px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-200">✦ Discover New Labels</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              AI suggestions compared against your {labels.length} existing labels
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-600 hover:text-neutral-400 text-lg px-2">✕</button>
        </div>

        {/* Body — two columns */}
        <div className="flex gap-4 px-5 pb-4 overflow-hidden flex-1 min-h-0">
          {/* Left: existing labels */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">
              Your Labels ({labels.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {labels.map(l => (
                <span
                  key={l.id}
                  className="px-2.5 py-1 rounded-full text-[11px] bg-neutral-800/80 border border-neutral-700/50 text-neutral-400"
                >
                  {l.name}
                </span>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="w-px bg-neutral-800 shrink-0" />

          {/* Right: suggestions */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">
              Suggestions ({candidates.length})
            </p>
            <div className="flex flex-col gap-2">
              {candidates.map(c => (
                <div key={c.id} className="bg-neutral-800/40 border border-neutral-700/50 rounded-lg p-2.5">
                  {/* Name row + actions */}
                  <div className="flex justify-between items-start gap-2 mb-0.5">
                    {renaming?.id === c.id ? (
                      <input
                        autoFocus
                        className="flex-1 bg-neutral-900 border border-amber-500/40 rounded px-1.5 py-0.5 text-xs text-amber-300 font-medium outline-none focus:border-amber-500"
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
                        className="text-xs font-medium text-amber-300 cursor-pointer hover:underline"
                        onClick={() => setRenaming({ id: c.id, value: c.name })}
                        title="Click to rename"
                      >
                        {c.name}
                      </span>
                    )}
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => onAccept(c.id)}
                        className="px-2 py-0.5 rounded text-[10px] bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => onReject(c.id)}
                        className="px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  {/* Similarity tag */}
                  {c.similar_to && (
                    <p className="text-[9px] text-violet-400 mb-1">
                      similar to: <span className="text-violet-300">{c.similar_to}</span>
                    </p>
                  )}

                  {/* Description */}
                  <p className="text-[10px] text-neutral-500 leading-snug">{c.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-neutral-800">
          <button
            onClick={onDiscover}
            disabled={discovering}
            className="px-3 py-1.5 rounded-md text-[11px] bg-violet-500/10 text-violet-400 border border-violet-500/30 hover:bg-violet-500/20 transition-colors disabled:opacity-50"
          >
            {discovering ? 'Discovering...' : '↻ Discover more'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[11px] bg-neutral-800 text-neutral-400 border border-neutral-700 hover:bg-neutral-700/50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
