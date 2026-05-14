import { useState } from 'react'
import type { SingleLabelDetail } from '../../types'

interface SettingsTabProps {
  detail: SingleLabelDetail
  onRehandoff: () => Promise<void>
  onSaveThreshold: (value: number) => Promise<void>
}

export function SettingsTab({ detail, onRehandoff, onSaveThreshold }: SettingsTabProps) {
  const [threshold, setThreshold] = useState(detail.review_threshold)
  const [saving, setSaving] = useState(false)

  return (
    <div className="px-7 py-6 overflow-y-auto flex-1">
      <div className="max-w-[640px]">
        <h3 className="font-serif font-medium text-[18px] text-paper mb-1">Review threshold</h3>
        <p className="font-serif text-[13.5px] text-on-surface mb-3 leading-[1.55]">
          Predictions with AI confidence below this value land in the Review bucket. Lowering it shrinks Review; raising it grows it.
        </p>
        <div className="flex items-center gap-3 mb-2">
          <input
            type="range"
            min="0.50" max="0.95" step="0.01"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="flex-1"
          />
          <span className="font-mono text-[13px] text-paper tabular-nums w-12">{threshold.toFixed(2)}</span>
        </div>
        <button
          onClick={async () => { setSaving(true); try { await onSaveThreshold(threshold) } finally { setSaving(false) } }}
          disabled={saving || threshold === detail.review_threshold}
          className="px-3 py-1.5 bg-ochre-dim border border-ochre text-paper rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save & re-bucket'}
        </button>

        <hr className="my-7 border-edge-subtle" />

        <h3 className="font-serif font-medium text-[18px] text-paper mb-1">Re-handoff</h3>
        <p className="font-serif text-[13.5px] text-on-surface mb-3 leading-[1.55]">
          Send the current label definition back to Gemini for a fresh classification. Useful after editing the description.
        </p>
        <button
          onClick={onRehandoff}
          className="px-3 py-1.5 border border-edge rounded-sm font-mono text-[10px] tracking-[0.12em] uppercase text-on-surface hover:text-paper"
        >
          ↺ Re-handoff full label
        </button>
      </div>
    </div>
  )
}
