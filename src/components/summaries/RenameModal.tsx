import { useState } from 'react'

interface RenameModalProps {
  initialName: string
  initialDescription: string | null
  onSave: (name: string, description: string) => void
  onCancel: () => void
}

export function RenameModal({ initialName, initialDescription, onSave, onCancel }: RenameModalProps) {
  const [name, setName] = useState(initialName)
  const [description, setDescription] = useState(initialDescription ?? '')

  return (
    <div className="fixed inset-0 bg-overlay flex items-center justify-center z-50">
      <div className="bg-modal-deep border border-edge rounded-md p-6 w-[480px] max-w-[90vw]">
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-faint mb-3">Edit label</div>
        <label className="block mb-3">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted mb-1.5">Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-canvas border border-edge rounded-sm px-3 py-2 text-paper font-serif text-[15px]"
          />
        </label>
        <label className="block mb-4">
          <div className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted mb-1.5">Description</div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full bg-canvas border border-edge rounded-sm px-3 py-2 text-paper font-serif text-[13.5px]"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 border border-edge rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase text-on-surface hover:text-paper">Cancel</button>
          <button onClick={() => onSave(name, description)} className="px-3 py-1.5 bg-ochre-dim border border-ochre text-paper rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase">Save</button>
        </div>
      </div>
    </div>
  )
}
