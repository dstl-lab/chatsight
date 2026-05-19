import { useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export function HoverTip({
  label,
  tip,
  tone = 'faint',
  className = '',
}: {
  label: string
  tip: string
  tone?: 'faint' | 'ochre' | 'paper'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const id = useId()
  const toneClass =
    tone === 'ochre' ? 'text-ochre' : tone === 'paper' ? 'text-on-surface' : 'text-faint'

  const show = () => {
    const el = triggerRef.current
    if (el) {
      const r = el.getBoundingClientRect()
      setCoords({ top: r.bottom + 6, left: r.left })
    }
    setOpen(true)
  }

  const hide = () => setOpen(false)

  return (
    <span
      className="relative inline shrink-0"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span
        ref={triggerRef}
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        className={`cursor-help border-b border-faint/70 outline-none ${toneClass} ${className}`.trim()}
      >
        {label}
      </span>
      {open &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{ top: coords.top, left: coords.left }}
            className="fixed z-[200] block w-[min(18rem,calc(100vw-3rem))] max-w-[18rem] rounded border border-edge bg-elevated px-2.5 py-2 text-[11px] font-sans normal-case tracking-normal leading-snug text-on-surface shadow-lg pointer-events-none"
          >
            {tip}
          </span>,
          document.body,
        )}
    </span>
  )
}
