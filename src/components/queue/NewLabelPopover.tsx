// src/components/queue/NewLabelPopover.tsx
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
    <div className="absolute bottom-full left-0 mb-2 bg-neutral-900 border border-neutral-700 rounded-lg p-4 shadow-2xl w-72 z-10">
      <p className="text-xs text-neutral-300 font-medium mb-3">New label</p>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleConfirm()}
        placeholder="Label name (required)"
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 mb-2 focus:outline-none focus:border-blue-600"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5 text-xs text-neutral-100 placeholder-neutral-600 mb-3 focus:outline-none focus:border-blue-600 resize-none"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs text-neutral-500 px-3 py-1 hover:text-neutral-300"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!name.trim()}
          className="text-xs bg-blue-600 text-white rounded px-3 py-1 disabled:opacity-40 hover:bg-blue-500 transition-colors"
        >
          Create & apply
        </button>
      </div>
    </div>
  )
}
