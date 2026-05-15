import { useState } from 'react'

interface DeleteConfirmModalProps {
  labelName: string
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteConfirmModal({ labelName, onConfirm, onCancel }: DeleteConfirmModalProps) {
  const [typed, setTyped] = useState('')
  const canDelete = typed === labelName

  return (
    <div className="fixed inset-0 bg-overlay flex items-center justify-center z-50">
      <div className="bg-modal-deep border border-brick-dim rounded-md p-6 w-[480px] max-w-[90vw]">
        <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-brick mb-3">Delete label</div>
        <p className="font-serif text-[14px] text-on-canvas mb-3 leading-[1.55]">
          This archives the label and returns its messages to the unlabeled pool.
          Type <span className="font-mono text-brick">{labelName}</span> to confirm.
        </p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          className="w-full bg-canvas border border-edge rounded-sm px-3 py-2 text-paper font-mono text-[13px] mb-4"
          placeholder={labelName}
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 border border-edge rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase text-on-surface hover:text-paper">Cancel</button>
          <button
            onClick={onConfirm}
            disabled={!canDelete}
            className="px-3 py-1.5 bg-brick-dim border border-brick text-paper rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}
