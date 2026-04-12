interface Props {
  labelName: string
  remainingCount: number
  onSkipAndArchive: () => void
  onCompleteArchive: () => void
  onCancel: () => void
}

export function ArchiveReviewBanner({ labelName, remainingCount, onSkipAndArchive, onCompleteArchive, onCancel }: Props) {
  const allDone = remainingCount === 0

  return (
    <div className={`${allDone ? 'bg-success-surface border-b border-success-border' : 'bg-warning-surface border-b border-warning-border'} px-4 py-2 flex items-center justify-between`}>
      <div className="flex items-center gap-2">
        <span className={`${allDone ? 'text-success' : 'text-warning'} text-sm`}>{allDone ? '\u2713' : '\u26A0'}</span>
        <span className={`${allDone ? 'text-success-on-surface' : 'text-warning-on-surface'} text-xs font-medium`}>
          {allDone
            ? `All messages relabeled — ready to archive \u201C${labelName}\u201D`
            : `Archiving \u201C${labelName}\u201D — relabel ${remainingCount} remaining ${remainingCount === 1 ? 'message' : 'messages'}`
          }
        </span>
      </div>
      <div className="flex gap-2">
        {allDone ? (
          <button
            onClick={onCompleteArchive}
            className="text-[11px] text-success-on-surface border border-success-border rounded px-2.5 py-1 hover:bg-success-surface transition-colors"
          >
            Complete archive
          </button>
        ) : (
          <button
            onClick={onSkipAndArchive}
            className="text-[11px] text-warning-on-surface border border-warning-border rounded px-2.5 py-1 hover:bg-warning-surface transition-colors"
          >
            Skip remaining & archive
          </button>
        )}
        <button
          onClick={onCancel}
          className="text-[11px] text-muted border border-edge rounded px-2.5 py-1 hover:bg-elevated transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
