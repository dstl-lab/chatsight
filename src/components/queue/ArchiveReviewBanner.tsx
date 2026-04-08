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
    <div className={`${allDone ? 'bg-green-900/60 border-b border-green-800' : 'bg-amber-900/60 border-b border-amber-800'} px-4 py-2 flex items-center justify-between`}>
      <div className="flex items-center gap-2">
        <span className={`${allDone ? 'text-green-400' : 'text-amber-400'} text-sm`}>{allDone ? '\u2713' : '\u26A0'}</span>
        <span className={`${allDone ? 'text-green-200' : 'text-amber-200'} text-xs font-medium`}>
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
            className="text-[11px] text-green-200 border border-green-700 rounded px-2.5 py-1 hover:bg-green-800/50 transition-colors"
          >
            Complete archive
          </button>
        ) : (
          <button
            onClick={onSkipAndArchive}
            className="text-[11px] text-amber-200 border border-amber-700 rounded px-2.5 py-1 hover:bg-amber-800/50 transition-colors"
          >
            Skip remaining & archive
          </button>
        )}
        <button
          onClick={onCancel}
          className="text-[11px] text-neutral-400 border border-neutral-700 rounded px-2.5 py-1 hover:bg-neutral-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
