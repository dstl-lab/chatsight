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
    <div className="bg-elevated border border-edge rounded-lg p-3 mt-2">
      <p className="text-xs text-tertiary font-medium mb-2">New label</p>
      <input
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && handleConfirm()}
        placeholder="Label name (required)"
        className="w-full bg-surface border border-edge rounded px-2.5 py-1.5 text-xs text-on-canvas placeholder-disabled mb-2 focus:outline-none focus:border-accent"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Description (optional)"
        rows={2}
        className="w-full bg-surface border border-edge rounded px-2.5 py-1.5 text-xs text-on-canvas placeholder-disabled mb-2 focus:outline-none focus:border-accent resize-none"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-xs text-faint px-2 py-1 hover:text-tertiary"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!name.trim()}
          className="text-xs bg-accent text-white rounded px-2.5 py-1 disabled:opacity-40 hover:bg-accent-hover transition-colors"
        >
          Create & select
        </button>
      </div>
    </div>
  )
}
