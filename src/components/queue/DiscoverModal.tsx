import { useState } from 'react'
import { api } from '../../services/api'
import type { ConceptCandidate, LabelDefinition } from '../../types'

interface Props {
  candidates: ConceptCandidate[]
  labels: LabelDefinition[]
  onAccept: (id: number, name?: string) => Promise<void>
  onReject: (id: number) => Promise<void>
  onDiscover: () => void
  onClose: () => void
  discovering: boolean
  /**
   * Optional callback fired when a Mode B candidate becomes a label,
   * is dismissed, noted, or merged. Lets the parent refresh state.
   */
  onCandidateChanged?: () => void
}

export default function DiscoverModal({
  candidates,
  labels,
  onAccept,
  onReject,
  onDiscover,
  onClose,
  discovering,
  onCandidateChanged,
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
                c.kind === 'co_occurrence' ? (
                  <CoOccurrenceCard
                    key={c.id}
                    c={c}
                    labels={labels}
                    onChanged={onCandidateChanged}
                  />
                ) : (
                  <BroadLabelCard
                    key={c.id}
                    c={c}
                    renaming={renaming}
                    setRenaming={setRenaming}
                    onAccept={onAccept}
                    onReject={onReject}
                  />
                )
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


function BroadLabelCard({
  c, renaming, setRenaming, onAccept, onReject,
}: {
  c: ConceptCandidate
  renaming: { id: number; value: string } | null
  setRenaming: (r: { id: number; value: string } | null) => void
  onAccept: (id: number, name?: string) => Promise<void>
  onReject: (id: number) => Promise<void>
}) {
  return (
    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-lg p-2.5">
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

      {c.similar_to && (
        <p className="text-[9px] text-violet-400 mb-1">
          similar to: <span className="text-violet-300">{c.similar_to}</span>
        </p>
      )}
      <p className="text-[10px] text-neutral-500 leading-snug">{c.description}</p>
      {c.discovery_run_id != null && (
        <p className="mt-1 text-[9px] text-neutral-600">
          run #{c.discovery_run_id} · broad
        </p>
      )}
    </div>
  )
}


function CoOccurrenceCard({
  c, labels, onChanged,
}: {
  c: ConceptCandidate
  labels: LabelDefinition[]
  onChanged?: () => void
}) {
  const [busy, setBusy] = useState(false)
  const ids = c.co_occurrence_label_ids ?? [0, 0]
  const count = c.co_occurrence_count ?? 0
  const labelById = new Map(labels.map(l => [l.id, l.name]))
  const a = labelById.get(ids[0]) ?? `#${ids[0]}`
  const b = labelById.get(ids[1]) ?? `#${ids[1]}`

  const note = async () => {
    setBusy(true)
    try { await api.noteConceptCandidate(c.id); onChanged?.() }
    finally { setBusy(false) }
  }
  const makeLabel = async () => {
    setBusy(true)
    try { await api.makeLabelFromCandidate(c.id); onChanged?.() }
    finally { setBusy(false) }
  }
  const dismiss = async () => {
    setBusy(true)
    try { await api.dismissConceptCandidate(c.id); onChanged?.() }
    finally { setBusy(false) }
  }
  const suggestMerge = async () => {
    if (!ids[0] || !ids[1]) return
    const archive = Math.min(ids[0], ids[1])
    const keep = Math.max(ids[0], ids[1])
    setBusy(true)
    try {
      await api.suggestMergeFromCandidate(c.id, archive, keep)
      onChanged?.()
    } finally { setBusy(false) }
  }

  return (
    <div className="bg-neutral-800/40 border border-neutral-700/50 rounded-lg p-2.5">
      <p className="text-xs font-medium text-violet-300">
        Pattern: <span className="text-violet-400">{a}</span>
        {' + '}
        <span className="text-violet-400">{b}</span>
      </p>
      <p className="text-[10px] text-neutral-500 mt-0.5">
        co-occur on {count} message{count === 1 ? '' : 's'}
      </p>
      {c.description && (
        <p className="mt-1 text-[10px] text-neutral-500 leading-snug">{c.description}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-1">
        <button
          disabled={busy}
          onClick={makeLabel}
          className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
        >
          Make a combo label
        </button>
        <button
          disabled={busy}
          onClick={suggestMerge}
          className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
        >
          Suggest merge
        </button>
        <button
          disabled={busy}
          onClick={note}
          className="px-2 py-0.5 rounded text-[10px] bg-neutral-700/50 text-neutral-300 hover:bg-neutral-700 transition-colors disabled:opacity-50"
        >
          Note only
        </button>
        <button
          disabled={busy}
          onClick={dismiss}
          className="px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
        >
          Dismiss
        </button>
      </div>

      {c.discovery_run_id != null && (
        <p className="mt-1 text-[9px] text-neutral-600">
          run #{c.discovery_run_id} · co-occurrence
        </p>
      )}
    </div>
  )
}
