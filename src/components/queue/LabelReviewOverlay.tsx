import { useState, useEffect } from 'react'
import type { LabelReviewItem } from '../../types'
import { api } from '../../services/api'

interface Props {
  items: LabelReviewItem[]
  onDismiss: () => void
}

export function LabelReviewOverlay({ items, onDismiss }: Props) {
  const [descriptions, setDescriptions] = useState<Record<number, string>>({})
  const [generating, setGenerating] = useState<Set<number>>(new Set())

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDismiss])

  useEffect(() => {
    const needsDef = items.filter(i => !i.description)
    if (needsDef.length === 0) return
    setGenerating(new Set(needsDef.map(i => i.label_id)))
    needsDef.forEach(item => {
      api.generateLabelDescription(item.label_id)
        .then(updated => {
          setDescriptions(prev => ({ ...prev, [item.label_id]: updated.description ?? '' }))
        })
        .catch(() => {})
        .finally(() => {
          setGenerating(prev => {
            const next = new Set(prev)
            next.delete(item.label_id)
            return next
          })
        })
    })
  }, [])

  if (items.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onDismiss}>
      <div
        className="bg-surface border border-edge rounded-xl p-6 w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-xs text-faint uppercase tracking-wide mb-4 shrink-0">
          Label review
        </p>

        <div className="flex flex-col gap-4 overflow-y-auto min-h-0 pr-1">
          {items.map(item => (
            <div key={item.label_id} className="border border-edge rounded-lg p-4">
              <p className="text-on-canvas text-sm font-semibold mb-1">{item.name}</p>
              {(() => {
                const desc = item.description ?? descriptions[item.label_id]
                const isLoading = !desc && generating.has(item.label_id)
                if (isLoading) return (
                  <p className="text-disabled text-xs mb-3 italic">Generating definition...</p>
                )
                if (desc) return (
                  <p className="text-muted text-xs mb-3">{desc}</p>
                )
                return null
              })()}
              {item.example_text ? (
                <>
                  <p className="text-xs text-faint uppercase tracking-wide mb-1">Human example</p>
                  <div
                    className="bg-elevated border border-edge rounded p-2 overflow-y-auto overflow-x-hidden"
                    style={{ maxHeight: '4.5rem' }}
                  >
                    <p className="text-tertiary text-xs whitespace-pre-wrap break-words">
                      {item.example_text}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-disabled italic">No human example yet.</p>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={onDismiss}
          className="mt-4 w-full bg-accent hover:bg-accent-hover text-white text-sm rounded-lg px-4 py-2 transition-colors shrink-0"
        >
          Resume labeling
        </button>
      </div>
    </div>
  )
}
