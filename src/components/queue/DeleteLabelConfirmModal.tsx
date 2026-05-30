import { useEffect } from 'react'

interface Props {
  labelName: string
  applicationCount: number
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteLabelConfirmModal({
  labelName,
  applicationCount,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay" onClick={onCancel}>
      <div
        className="bg-surface border border-edge rounded-xl p-6 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-danger-text text-lg">&#9888;</span>
          <h3 className="text-on-canvas text-base font-semibold">Delete &ldquo;{labelName}&rdquo;?</h3>
        </div>

        {applicationCount === 0 ? (
          <p className="text-muted text-sm mb-5">This label has no applications.</p>
        ) : (
          <p className="text-muted text-sm mb-5">
            This permanently removes the label and its{' '}
            <span className="text-on-canvas font-medium">
              {applicationCount} {applicationCount === 1 ? 'application' : 'applications'}
            </span>
            . Messages with no other labels will return to the queue.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={onConfirm}
            className="w-full py-2 text-xs font-semibold bg-danger text-white rounded hover:brightness-110 transition-all"
          >
            Delete label
          </button>
          <button
            onClick={onCancel}
            className="w-full py-2 text-xs text-muted hover:text-on-surface transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
