interface Props {
  labelName: string
  remainingCount: number
  onSkipAndArchive: () => void
  onCancel: () => void
}

export function ArchiveReviewBanner({ labelName, remainingCount, onSkipAndArchive, onCancel }: Props) {
  return (
    <div className="bg-amber-900/60 border-b border-amber-800 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-amber-400 text-sm">&#9888;</span>
        <span className="text-amber-200 text-xs font-medium">
          Archiving &ldquo;{labelName}&rdquo; — relabel {remainingCount} remaining {remainingCount === 1 ? 'message' : 'messages'}
        </span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onSkipAndArchive}
          className="text-[11px] text-amber-200 border border-amber-700 rounded px-2.5 py-1 hover:bg-amber-800/50 transition-colors"
        >
          Skip remaining & archive
        </button>
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
