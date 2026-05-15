import { useState, useEffect } from 'react'

interface NoteEditorProps {
  note: string | null
  onSave: (text: string) => void
}

export function NoteEditor({ note, onSave }: NoteEditorProps) {
  const [open, setOpen] = useState(note !== null)
  const [draft, setDraft] = useState(note ?? '')

  useEffect(() => {
    setOpen(note !== null)
    setDraft(note ?? '')
  }, [note])

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3.5 inline-block px-2.5 py-1.5 border border-dashed border-edge rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase text-muted hover:text-paper"
      >
        + add note
      </button>
    )
  }

  return (
    <div className="mt-3.5">
      <div className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-faint mb-2">your note (saves on blur)</div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onSave(draft)}
        placeholder="e.g. 'this is more like prompt-rereading than self-correction'…"
        className="w-full min-h-[56px] bg-canvas border border-edge rounded-sm px-3 py-2 text-paper font-serif text-[13.5px] leading-[1.5] focus:border-ochre-dim focus:outline-none"
      />
    </div>
  )
}
