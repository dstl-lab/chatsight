import { useEffect, useRef, useState } from 'react'

interface NoteLabelPopoverProps {
  open: boolean
  onClose: () => void
  onSubmit: (name: string, description: string) => void
}

export function NoteLabelPopover({ open, onClose, onSubmit }: NoteLabelPopoverProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => nameRef.current?.focus())
    } else {
      setName('')
      setDescription('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter' && document.activeElement === nameRef.current) {
        e.preventDefault()
        if (name.trim()) onSubmit(name.trim(), description.trim())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, name, description, onSubmit, onClose])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 bg-overlay z-40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(440px,92vw)] bg-bg-warm border border-edge rounded-md shadow-2xl z-50"
      >
        <div className="px-[22px] pt-[18px] pb-3 border-b border-edge-subtle">
          <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-ochre mb-1.5">
            Queue a label
          </div>
          <h3 className="font-serif font-medium text-[20px] text-paper m-0 tracking-[-0.014em] leading-[1.25]">
            Note a label for later
          </h3>
          <div className="mt-1 font-serif text-[13px] text-muted leading-[1.45]">
            Capture a label you want to come back to. It joins the queue and becomes active when
            you close the current label.
          </div>
        </div>
        <div className="px-[22px] pt-4 pb-3 flex flex-col gap-3.5">
          <Field label="Name">
            <input
              ref={nameRef}
              type="text"
              autoComplete="off"
              placeholder="e.g. frustration"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="appearance-none bg-canvas border border-edge text-on-canvas px-[11px] py-[9px] rounded-sm font-sans text-[13px] focus:outline-none focus:border-ochre-dim"
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              placeholder="What does this label cover? Examples help Gemini later."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="appearance-none bg-canvas border border-edge text-on-canvas px-[11px] py-[9px] rounded-sm font-sans text-[13px] resize-y min-h-[64px] focus:outline-none focus:border-ochre-dim"
            />
          </Field>
        </div>
        <div className="flex items-center gap-3 px-[22px] py-3 pb-[18px] border-t border-edge-subtle">
          <div className="flex-1 font-mono text-[9px] tracking-[0.14em] uppercase text-faint">
            <KeyHint>⏎</KeyHint> add &nbsp; <KeyHint>Esc</KeyHint> cancel
          </div>
          <button
            onClick={onClose}
            className="appearance-none border border-edge bg-transparent text-on-surface px-4 py-[9px] rounded-sm cursor-pointer font-sans font-medium text-[13px] hover:text-on-canvas hover:border-faint transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => name.trim() && onSubmit(name.trim(), description.trim())}
            disabled={!name.trim()}
            className="appearance-none border border-ochre bg-ochre text-bg-warm px-4 py-[9px] rounded-sm cursor-pointer font-sans font-semibold text-[13px] hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Add to queue
          </button>
        </div>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[5px]">
      <label className="font-mono text-[9px] tracking-[0.16em] uppercase text-faint">
        {label}
      </label>
      {children}
    </div>
  )
}

function KeyHint({ children }: { children: React.ReactNode }) {
  return (
    <b className="text-muted font-medium border border-edge px-[5px] py-px rounded-sm mx-[3px]">
      {children}
    </b>
  )
}
