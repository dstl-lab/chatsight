import { useEffect } from 'react'

interface Props {
  labelName: string
  yesCount: number
  noCount: number
  onConfirm: () => void
  onCancel: () => void
}

export function AbortConfirmModal({ labelName, yesCount, noCount, onConfirm, onCancel }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  const total = yesCount + noCount

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay" onClick={onCancel}>
      <div
        className="bg-surface border border-edge rounded-xl p-6 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-brick text-lg">&#9888;</span>
          <h3 className="text-on-canvas text-base font-semibold">
            Abort &ldquo;{labelName}&rdquo;?
          </h3>
        </div>

        {total === 0 ? (
          <p className="text-muted text-sm mb-5">No decisions yet — nothing will be lost.</p>
        ) : (
          <p className="text-muted text-sm mb-5">
            <span className="text-on-canvas font-medium">{total}</span> decision
            {total === 1 ? '' : 's'}
            {' '}
            (<span className="text-moss">{yesCount} yes</span>
            {' · '}
            <span className="text-brick">{noCount} no</span>) will be permanently discarded.
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 bg-transparent border border-edge text-muted hover:text-on-surface text-sm rounded-lg px-4 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 bg-danger hover:bg-danger-hover text-white text-sm rounded-lg px-4 py-2 transition-colors"
          >
            Abort
          </button>
        </div>
      </div>
    </div>
  )
}
