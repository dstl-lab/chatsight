import { useEffect, useRef, useState } from 'react'
import type { AssignmentMapping, UnmappedCount } from '../../types'

interface AssignmentPickerProps {
  assignments: AssignmentMapping[]
  unmapped: UnmappedCount | null
  selectedId: number | null  // null = "all conversations"
  onSelect: (id: number | null) => void
}

export function AssignmentPicker({
  assignments,
  unmapped,
  selectedId,
  onSelect,
}: AssignmentPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = assignments.find((a) => a.id === selectedId)
  const label = selected?.name ?? 'All conversations'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-[11px] py-[5px] rounded-full font-mono text-[11px] tracking-[0.04em] text-muted hover:text-on-canvas transition-colors"
      >
        {label} <span className="opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-[260px] bg-bg-warm border border-edge rounded-md shadow-2xl py-1.5">
          <PickerItem
            active={selectedId === null}
            onClick={() => {
              onSelect(null)
              setOpen(false)
            }}
            name="All conversations"
            count={unmapped?.total_count ?? null}
          />
          {assignments.length > 0 && (
            <div className="h-px bg-edge mx-2 my-1" />
          )}
          {assignments.map((a) => (
            <PickerItem
              key={a.id}
              active={selectedId === a.id}
              onClick={() => {
                onSelect(a.id)
                setOpen(false)
              }}
              name={a.name}
              count={a.message_count}
            />
          ))}
          {unmapped && unmapped.unmapped_count > 0 && (
            <PickerItem
              active={false}
              disabled
              onClick={() => {}}
              name="Unmapped"
              count={unmapped.unmapped_count}
              hint
            />
          )}
          <div className="h-px bg-edge mx-2 my-1" />
          <a
            href="/assignments"
            className="block px-3 py-2 font-mono text-[10px] tracking-[0.06em] uppercase text-muted hover:text-ochre transition-colors"
          >
            + Manage assignments →
          </a>
        </div>
      )}
    </div>
  )
}

interface PickerItemProps {
  active: boolean
  onClick: () => void
  name: string
  count: number | null
  disabled?: boolean
  hint?: boolean
}

function PickerItem({ active, onClick, name, count, disabled, hint }: PickerItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        w-full flex items-center justify-between gap-3 px-3 py-2 text-left
        text-[13px] transition-colors
        ${active ? 'bg-surface text-paper' : hint ? 'text-faint' : 'text-on-surface'}
        ${disabled ? 'cursor-default' : 'hover:bg-surface hover:text-paper cursor-pointer'}
      `}
    >
      <span className="font-sans">{name}</span>
      {count !== null && (
        <span className={`font-mono text-[10px] ${active ? 'text-ochre' : 'text-faint'}`}>
          {count}
        </span>
      )}
    </button>
  )
}
