import { useState, useEffect } from 'react'
import type { RecalibrationItem } from '../../types'
import { api } from '../../services/api'

interface Props {
  items: RecalibrationItem[]
  onDismiss: () => void
}

export function RecalibrationOverlay({ items, onDismiss }: Props) {
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
    const needsDef = items.filter(i => !i.description || i.description.startsWith('AI Generated:'))
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
        className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 w-full max-w-lg shadow-2xl flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-xs text-neutral-500 uppercase tracking-wide mb-4 shrink-0">
          Recalibration reminder
        </p>

        <div className="flex flex-col gap-4 overflow-y-auto min-h-0 pr-1">
          {items.map(item => (
            <div key={item.label_id} className="border border-neutral-700 rounded-lg p-4">
              <p className="text-neutral-100 text-sm font-semibold mb-1">{item.name}</p>
              {(() => {
                const desc = item.description ?? descriptions[item.label_id]
                const isLoading = !desc && generating.has(item.label_id)
                if (isLoading) return (
                  <p className="text-neutral-600 text-xs mb-3 italic">Generating definition...</p>
                )
                if (desc) return (
                  <p className="text-neutral-400 text-xs mb-3">{desc}</p>
                )
                return null
              })()}
              {item.example_text ? (
                <>
                  <p className="text-xs text-neutral-500 uppercase tracking-wide mb-1">Human example</p>
                  <div
                    className="bg-neutral-800 border border-neutral-700 rounded p-2 overflow-y-auto overflow-x-hidden"
                    style={{ maxHeight: '4.5rem' }}
                  >
                    <p className="text-neutral-300 text-xs whitespace-pre-wrap break-words">
                      {item.example_text}
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-xs text-neutral-600 italic">No human example yet.</p>
              )}
            </div>
          ))}
        </div>

        <button
          onClick={onDismiss}
          className="mt-4 w-full bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-4 py-2 transition-colors shrink-0"
        >
          Resume labeling
        </button>
      </div>
    </div>
  )
}
