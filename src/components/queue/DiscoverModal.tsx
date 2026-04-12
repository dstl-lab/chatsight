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
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-modal-deep border border-edge-subtle rounded-xl shadow-2xl w-full max-w-[720px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[15px] font-semibold text-on-surface">✦ Discover New Labels</h2>
            <p className="text-[11px] text-faint mt-0.5">
              AI suggestions compared against your {labels.length} existing labels
            </p>
          </div>
          <button onClick={onClose} className="text-disabled hover:text-muted text-lg px-2">✕</button>
        </div>

        {/* Body — two columns */}
        <div className="flex gap-4 px-5 pb-4 overflow-hidden flex-1 min-h-0">
          {/* Left: existing labels */}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-widest text-faint mb-2">
              Your Labels ({labels.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {labels.map(l => (
                <span
                  key={l.id}
                  className="px-2.5 py-1 rounded-full text-[11px] bg-elevated/80 border border-edge/50 text-muted"
                >
                  {l.name}
                </span>
              ))}
            </div>
          </div>

          {/* Divider */}
          <div className="w-px bg-edge-subtle shrink-0" />

          {/* Right: suggestions */}
          <div className="flex-1 min-w-0 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-widest text-faint mb-2">
              Suggestions ({candidates.length})
            </p>
            <div className="flex flex-col gap-2">
              {candidates.map(c => (
                <div key={c.id} className="bg-elevated/40 border border-edge/50 rounded-lg p-2.5">
                  {/* Name row + actions */}
                  <div className="flex justify-between items-start gap-2 mb-0.5">
                    {renaming?.id === c.id ? (
                      <input
                        autoFocus
                        className="flex-1 bg-surface border border-warning-border rounded px-1.5 py-0.5 text-xs text-warning-name font-medium outline-none focus:border-warning"
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
                        className="text-xs font-medium text-warning-name cursor-pointer hover:underline"
                        onClick={() => setRenaming({ id: c.id, value: c.name })}
                        title="Click to rename"
                      >
                        {c.name}
                      </span>
                    )}
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => onAccept(c.id)}
                        className="px-2 py-0.5 rounded text-[10px] bg-success-surface text-success hover:bg-success-surface transition-colors"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => onReject(c.id)}
                        className="px-2 py-0.5 rounded text-[10px] bg-danger-surface text-danger-text hover:bg-danger-surface transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  </div>

                  {/* Similarity tag */}
                  {c.similar_to && (
                    <p className="text-[9px] text-discover-text mb-1">
                      similar to: <span className="text-discover-strong">{c.similar_to}</span>
                    </p>
                  )}

                  {/* Description */}
                  <p className="text-[10px] text-faint leading-snug">{c.description}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center px-5 py-3 border-t border-edge-subtle">
          <button
            onClick={onDiscover}
            disabled={discovering}
            className="px-3 py-1.5 rounded-md text-[11px] bg-discover-surface text-discover-text border border-discover-border hover:bg-discover-surface transition-colors disabled:opacity-50"
          >
            {discovering ? 'Discovering...' : '↻ Discover more'}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-[11px] bg-elevated text-muted border border-edge hover:bg-elevated-hl/50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
