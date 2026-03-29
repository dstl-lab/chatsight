// src/components/queue/LabelStrip.tsx
import { useState } from 'react'
import type { LabelDefinition } from '../../types'
import { NewLabelPopover } from './NewLabelPopover'

interface Props {
  labels: LabelDefinition[]
  onApply: (labelId: number) => void
  onCreateAndApply: (name: string, description?: string) => void
}

export function LabelStrip({ labels, onApply, onCreateAndApply }: Props) {
  const [showPopover, setShowPopover] = useState(false)

  return (
    <div className="border-t border-neutral-800 px-3 py-2 relative shrink-0">
      <div className="flex flex-wrap gap-2">
        {labels.map(label => (
          <button
            key={label.id}
            onClick={() => onApply(label.id)}
            className="bg-neutral-900 border border-neutral-700 rounded px-3 py-1 text-xs text-neutral-200 hover:bg-neutral-800 hover:border-blue-600 transition-colors"
          >
            {label.name}
          </button>
        ))}
        <button
          onClick={() => setShowPopover(true)}
          className="bg-transparent border border-dashed border-neutral-700 rounded px-3 py-1 text-xs text-blue-400 hover:border-blue-500 transition-colors"
        >
          + New label
        </button>
      </div>

      {showPopover && (
        <NewLabelPopover
          onConfirm={(name, description) => {
            onCreateAndApply(name, description)
            setShowPopover(false)
          }}
          onCancel={() => setShowPopover(false)}
        />
      )}
    </div>
  )
}
