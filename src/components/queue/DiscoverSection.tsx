import type { ConceptCandidate } from '../../types'

interface Props {
  candidates: ConceptCandidate[]
  aiUnlocked: boolean
  labeledCount: number
  onDiscover: () => void
  onOpenModal: () => void
  discovering: boolean
}

export default function DiscoverSection({
  candidates,
  aiUnlocked,
  labeledCount,
  onDiscover,
  onOpenModal,
  discovering,
}: Props) {
  const nudgeThresholds = [30, 50, 80]
  const showNudge = candidates.length === 0 && nudgeThresholds.some(t => labeledCount >= t && labeledCount < t + 5)

  if (!aiUnlocked) return null

  return (
    <div className="mb-3">
      <p className="text-[10px] uppercase tracking-widest text-faint mb-1.5">Discover</p>

      {candidates.length === 0 ? (
        <button
          onClick={onDiscover}
          disabled={discovering}
          className="w-full text-xs py-1.5 px-2 rounded border border-dashed border-discover-border text-discover-strong hover:bg-discover-surface transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          {discovering ? (
            <span className="flex items-center justify-center gap-1.5">
              <span className="inline-block w-3 h-3 border-2 border-discover-text border-t-transparent rounded-full animate-spin" />
              Discovering...
            </span>
          ) : (
            <>
              ✦ Discover New Labels
              {showNudge && (
                <span className="block text-[10px] text-warning mt-0.5">
                  Some messages may not fit your labels
                </span>
              )}
            </>
          )}
        </button>
      ) : (
        <button
          onClick={onOpenModal}
          className="w-full text-xs py-1.5 px-2 rounded border border-discover-border bg-discover-surface text-discover-strong hover:bg-discover-surface transition-colors"
        >
          ✦ {candidates.length} suggestion{candidates.length !== 1 ? 's' : ''}
        </button>
      )}
    </div>
  )
}
