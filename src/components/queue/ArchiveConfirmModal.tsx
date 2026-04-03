import { useEffect } from 'react'

interface Props {
  labelName: string
  totalApplications: number
  orphanedCount: number
  onReviewAndRelabel: () => void
  onArchiveAnyway: () => void
  onCancel: () => void
}

export function ArchiveConfirmModal({
  labelName, totalApplications, orphanedCount,
  onReviewAndRelabel, onArchiveAnyway, onCancel,
}: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onCancel}>
      <div className="bg-neutral-900 border border-neutral-700 rounded-xl p-6 max-w-sm w-full shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-amber-400 text-lg">&#9888;</span>
          <h3 className="text-neutral-100 text-base font-semibold">Archive &ldquo;{labelName}&rdquo;?</h3>
        </div>

        {totalApplications === 0 ? (
          <p className="text-neutral-400 text-sm mb-5">This label has no applications.</p>
        ) : (
          <>
            <p className="text-neutral-400 text-sm mb-1">
              Applied to <span className="text-neutral-100 font-medium">{totalApplications} messages</span>.
            </p>
            {orphanedCount > 0 && (
              <p className="text-amber-400 text-sm mb-5">
                <span className="font-medium">{orphanedCount} {orphanedCount === 1 ? 'message' : 'messages'}</span> only {orphanedCount === 1 ? 'has' : 'have'} this label and will return to the queue.
              </p>
            )}
            {orphanedCount === 0 && <div className="mb-5" />}
          </>
        )}

        <div className="flex flex-col gap-2">
          {orphanedCount > 0 && (
            <button
              onClick={onReviewAndRelabel}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-4 py-2 transition-colors"
            >
              Review & relabel ({orphanedCount} {orphanedCount === 1 ? 'message' : 'messages'})
            </button>
          )}
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 bg-transparent border border-neutral-700 text-neutral-400 hover:text-neutral-200 text-sm rounded-lg px-4 py-2 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onArchiveAnyway}
              className="flex-1 bg-red-600 hover:bg-red-500 text-white text-sm rounded-lg px-4 py-2 transition-colors"
            >
              Archive{orphanedCount > 0 ? ' anyway' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
