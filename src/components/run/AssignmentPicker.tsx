import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 260 })

  useLayoutEffect(() => {
    if (!open) return
    const anchor = ref.current
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const menuW = 260
    const left = Math.min(
      Math.max(12, r.right - menuW),
      window.innerWidth - menuW - 12,
    )
    setMenuPos({ top: r.bottom + 8, left, width: menuW })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return
      setOpen(false)
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
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-[11px] py-[5px] rounded-full font-mono text-[11px] tracking-[0.04em] text-muted hover:text-on-canvas transition-colors"
      >
        {label} <span className="opacity-60">▾</span>
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label="Filter by assignment"
            style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
            className="fixed z-[250] max-h-[min(80vh,560px)] overflow-y-auto overscroll-contain bg-bg-warm border border-edge rounded-md shadow-2xl"
          >
            <div className="sticky top-0 z-10 bg-bg-warm pt-1.5">
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
                <div className="h-px bg-edge mx-2 mt-1" />
              )}
            </div>
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
            <div className="sticky bottom-0 z-10 bg-bg-warm pb-1.5">
              <div className="h-px bg-edge mx-2 mb-1" />
              <a
                href="/assignments"
                className="block px-3 py-2 font-mono text-[10px] tracking-[0.06em] uppercase text-muted hover:text-ochre transition-colors"
              >
                + Manage assignments →
              </a>
            </div>
          </div>,
          document.body,
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
      type="button"
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
