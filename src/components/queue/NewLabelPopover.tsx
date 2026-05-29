import { useState } from 'react'

interface Props {
  onConfirm: (name: string, description?: string) => void
  onCancel: () => void
}

export function NewLabelPopover({ onConfirm, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const handleConfirm = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    onConfirm(trimmed, description.trim() || undefined)
  }

  return (
    <div className="bg-elevated border border-edge rounded-sm p-3 mt-2">
      <p className="font-serif text-xs text-paper mb-2">New label</p>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleConfirm()}
        placeholder="Label name (required)"
        className="w-full bg-surface border border-edge rounded-sm px-2.5 py-1.5 text-xs text-paper placeholder:text-faint mb-2 focus:outline-none focus:border-ochre-dim"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full bg-surface border border-edge rounded-sm px-2.5 py-1.5 text-xs text-paper placeholder:text-faint mb-2 focus:outline-none focus:border-ochre-dim resize-none"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs text-faint px-2 py-1 hover:text-muted"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!name.trim()}
          className="text-xs border border-ochre bg-ochre text-bg-warm rounded-sm px-2.5 py-1 disabled:opacity-40 hover:brightness-110 transition-all"
        >
          Create & select
        </button>
      </div>
    </div>
  )
}
