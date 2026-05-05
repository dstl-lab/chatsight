import { useEffect, useState, type DragEvent } from 'react'
import { api } from '../services/api'
import type { AssignmentMapping, UnmappedCount } from '../types'

export function AssignmentsPage() {
  const [mappings, setMappings] = useState<AssignmentMapping[]>([])
  const [unmapped, setUnmapped] = useState<UnmappedCount | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inferring, setInferring] = useState(false)
  const [inferToast, setInferToast] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [pendingMerge, setPendingMerge] = useState<{
    source: AssignmentMapping
    target: AssignmentMapping
    name: string
  } | null>(null)
  const [merging, setMerging] = useState(false)

  const refresh = async () => {
    const [list, count] = await Promise.all([
      api.listAssignments(),
      api.getUnmappedCount(),
    ])
    setMappings(list)
    setUnmapped(count)
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
  }, [])

  const handleDelete = async (id: number) => {
    await api.deleteAssignment(id)
    await refresh()
  }

  const handleCreate = async (pattern: string, name: string, description: string) => {
    setError(null)
    try {
      await api.createAssignment({
        pattern,
        name,
        description: description || undefined,
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create')
    }
  }

  const handleInfer = async () => {
    setInferring(true)
    setInferToast(null)
    try {
      const result = await api.inferAssignments()
      await refresh()
      setInferToast(
        result.created === 0
          ? `No new assignments — already have all ${result.total_notebooks} notebooks covered.`
          : `Created ${result.created} assignment${result.created === 1 ? '' : 's'} from ${result.total_notebooks} notebook${result.total_notebooks === 1 ? '' : 's'}.`,
      )
    } catch (e) {
      setInferToast(e instanceof Error ? e.message : 'Auto-detect failed')
    } finally {
      setInferring(false)
    }
  }

  // ─── Drag-and-drop merge ───
  const onDragStart = (e: DragEvent<HTMLDivElement>, id: number) => {
    setDraggingId(id)
    e.dataTransfer.effectAllowed = 'move'
    // Required by Firefox to start the drag
    e.dataTransfer.setData('text/plain', String(id))
  }
  const onDragEnd = () => {
    setDraggingId(null)
    setDragOverId(null)
  }
  const onDragOver = (e: DragEvent<HTMLDivElement>, id: number) => {
    if (draggingId == null || draggingId === id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverId !== id) setDragOverId(id)
  }
  const onDragLeave = (id: number) => {
    if (dragOverId === id) setDragOverId(null)
  }
  const onDrop = (e: DragEvent<HTMLDivElement>, targetId: number) => {
    e.preventDefault()
    setDragOverId(null)
    if (draggingId == null || draggingId === targetId) {
      setDraggingId(null)
      return
    }
    const source = mappings.find((m) => m.id === draggingId)
    const target = mappings.find((m) => m.id === targetId)
    setDraggingId(null)
    if (!source || !target) return
    setPendingMerge({ source, target, name: target.name })
  }

  const cancelMerge = () => setPendingMerge(null)

  const confirmMerge = async () => {
    if (!pendingMerge) return
    setMerging(true)
    try {
      await api.mergeAssignments({
        source_ids: [pendingMerge.source.id],
        target_id: pendingMerge.target.id,
        new_name: pendingMerge.name.trim() || undefined,
      })
      setPendingMerge(null)
      await refresh()
    } finally {
      setMerging(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-faint text-xs tracking-widest uppercase animate-pulse">
        Loading…
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto bg-canvas">
      <div className="max-w-[880px] mx-auto px-12 py-12">
        <h1 className="font-serif font-medium text-[32px] text-paper tracking-[-0.018em] m-0 mb-1.5">
          Assignments
        </h1>
        <p className="font-serif text-on-surface text-[14px] leading-[1.6] max-w-[560px] mb-7">
          Group conversations by lab or project so you can label one at a time. Patterns are
          matched against the notebook filename in each conversation's first event.{' '}
          <span className="text-muted">Drag one assignment onto another to combine them.</span>
        </p>

        <div className="mb-6 flex items-center gap-4">
          {unmapped && (
            <div className="text-[12px] font-mono tracking-[0.06em] uppercase text-faint">
              {mappings.length} mapping{mappings.length === 1 ? '' : 's'}
              <span className="opacity-50 mx-2">·</span>
              {unmapped.unmapped_count} unmapped of {unmapped.total_count} cached messages
            </div>
          )}
          <span className="flex-1" />
          <button
            onClick={handleInfer}
            disabled={inferring}
            className="appearance-none border border-edge bg-bg-warm text-on-canvas px-3.5 py-2 rounded-sm cursor-pointer font-mono text-[11px] tracking-[0.06em] uppercase hover:border-ochre-dim hover:text-ochre transition-colors disabled:opacity-60 disabled:cursor-wait"
            title="Detect assignments from cached notebook filenames (read-only on Kubernetes DB)"
          >
            {inferring ? 'Detecting…' : '↻ Auto-detect from notebooks'}
          </button>
        </div>
        {inferToast && (
          <div className="mb-4 font-serif text-[14px] text-ochre">
            {inferToast}
          </div>
        )}

        <div className="grid grid-cols-[1.3fr_1.6fr_80px_28px] gap-4 items-center font-mono text-[10px] tracking-[0.14em] uppercase text-faint border-b border-edge pb-2">
          <div>Pattern</div>
          <div>Assignment name</div>
          <div className="text-right">Messages</div>
          <div></div>
        </div>

        {mappings.length === 0 ? (
          <div className="py-8 text-center font-serif text-on-surface">
            No assignments yet. Create one below to start grouping conversations.
          </div>
        ) : (
          mappings.map((m) => {
            const isDragging = draggingId === m.id
            const isDropTarget = dragOverId === m.id && draggingId !== null && draggingId !== m.id
            return (
              <div
                key={m.id}
                draggable
                onDragStart={(e) => onDragStart(e, m.id)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => onDragOver(e, m.id)}
                onDragLeave={() => onDragLeave(m.id)}
                onDrop={(e) => onDrop(e, m.id)}
                className={`
                  grid grid-cols-[1.3fr_1.6fr_80px_28px] gap-4 items-center
                  py-3.5 px-2 -mx-2 border-b border-edge
                  cursor-grab active:cursor-grabbing transition-all
                  ${isDragging ? 'opacity-30' : ''}
                  ${isDropTarget ? 'bg-surface ring-1 ring-ochre rounded-sm border-transparent' : ''}
                `}
              >
                <div className="flex items-center gap-2.5 select-none">
                  <span className="text-faint text-[10px] leading-none" aria-hidden>⋮⋮</span>
                  <span className="inline-block font-mono text-[13px] text-ochre bg-surface px-2.5 py-1.5 rounded-sm">
                    {m.pattern}
                  </span>
                </div>
                <div className="font-serif text-[17px] text-paper select-none">{m.name}</div>
                <div className="font-mono text-[12px] text-on-surface text-right select-none">
                  {m.message_count}
                </div>
                <button
                  onClick={() => handleDelete(m.id)}
                  onMouseDown={(e) => e.stopPropagation()}
                  draggable={false}
                  className="text-faint hover:text-brick text-base text-right w-6 h-6 leading-6 cursor-pointer"
                  title="Delete mapping"
                >
                  ×
                </button>
              </div>
            )
          })
        )}

        <AddForm onSubmit={handleCreate} error={error} />
      </div>

      {pendingMerge && (
        <MergeBar
          source={pendingMerge.source}
          target={pendingMerge.target}
          name={pendingMerge.name}
          onNameChange={(name) =>
            setPendingMerge((p) => (p ? { ...p, name } : null))
          }
          onSwap={() =>
            setPendingMerge((p) =>
              p
                ? { source: p.target, target: p.source, name: p.source.name }
                : null,
            )
          }
          onCancel={cancelMerge}
          onConfirm={confirmMerge}
          busy={merging}
        />
      )}
    </div>
  )
}

interface MergeBarProps {
  source: AssignmentMapping
  target: AssignmentMapping
  name: string
  onNameChange: (n: string) => void
  onSwap: () => void
  onCancel: () => void
  onConfirm: () => void
  busy: boolean
}

function MergeBar({
  source,
  target,
  name,
  onNameChange,
  onSwap,
  onCancel,
  onConfirm,
  busy,
}: MergeBarProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed left-1/2 -translate-x-1/2 bottom-8 z-30 bg-bg-warm border border-edge rounded-md shadow-2xl px-5 py-4 flex items-center gap-4 max-w-[min(720px,92vw)]"
    >
      <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-ochre shrink-0">
        Merge
      </div>
      <div className="flex items-center gap-2 font-serif text-[15px]">
        <span className="text-paper">{source.name}</span>
        <span className="text-faint font-mono text-[12px]">→</span>
        <span className="text-paper">{target.name}</span>
        <button
          onClick={onSwap}
          className="ml-1 text-faint hover:text-ochre transition-colors font-mono text-[10px] tracking-[0.08em] uppercase border border-edge px-1.5 py-0.5 rounded-sm"
          title="Swap which one is kept"
        >
          ⇄ swap
        </button>
      </div>
      <span className="flex-1 min-w-4" />
      <input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Final name"
        autoFocus
        className="appearance-none bg-canvas border border-edge text-on-canvas px-2.5 py-1.5 rounded-sm font-sans text-[13px] focus:outline-none focus:border-ochre-dim w-44"
      />
      <button
        onClick={onCancel}
        className="appearance-none border border-edge bg-transparent text-on-surface px-3 py-1.5 rounded-sm cursor-pointer font-sans font-medium text-[12px] hover:text-on-canvas hover:border-faint transition-colors"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={busy || !name.trim()}
        className="appearance-none border border-ochre bg-ochre text-bg-warm px-3.5 py-1.5 rounded-sm cursor-pointer font-sans font-semibold text-[12px] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {busy ? 'Merging…' : 'Merge'}
      </button>
    </div>
  )
}

interface AddFormProps {
  onSubmit: (pattern: string, name: string, description: string) => Promise<void>
  error: string | null
}

function AddForm({ onSubmit, error }: AddFormProps) {
  const [pattern, setPattern] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!pattern.trim() || !name.trim()) return
    setBusy(true)
    try {
      await onSubmit(pattern.trim(), name.trim(), description.trim())
      setPattern('')
      setName('')
      setDescription('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-7 p-[22px] border border-dashed border-edge rounded-sm bg-surface">
      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end">
        <Field label="Regex pattern">
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="^lab0?3"
            className="appearance-none bg-bg-warm border border-edge text-on-canvas px-3 py-2.5 rounded-sm font-mono text-[13px] focus:outline-none focus:border-ochre-dim"
          />
        </Field>
        <Field label="Assignment name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Lab 3"
            className="appearance-none bg-bg-warm border border-edge text-on-canvas px-3 py-2.5 rounded-sm font-mono text-[13px] focus:outline-none focus:border-ochre-dim"
          />
        </Field>
        <Field label="Description (optional)">
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder=""
            className="appearance-none bg-bg-warm border border-edge text-on-canvas px-3 py-2.5 rounded-sm font-mono text-[13px] focus:outline-none focus:border-ochre-dim"
          />
        </Field>
        <button
          onClick={submit}
          disabled={busy || !pattern.trim() || !name.trim()}
          className="appearance-none border border-ochre bg-ochre text-bg-warm px-4 py-2.5 rounded-sm cursor-pointer font-sans font-semibold text-[13px] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed self-end"
        >
          Add mapping
        </button>
      </div>
      {error && (
        <div className="mt-3 font-mono text-[11px] text-brick">{error}</div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="font-mono text-[10px] tracking-[0.14em] uppercase text-faint">
        {label}
      </label>
      {children}
    </div>
  )
}
