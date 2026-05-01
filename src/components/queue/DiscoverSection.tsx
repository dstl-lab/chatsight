import { useEffect, useState } from 'react'
import { api } from '../../services/api'
import type {
  ConceptCandidate, ConceptCandidateKind, RipeSignal,
} from '../../types'

interface Props {
  candidates: ConceptCandidate[]
  aiUnlocked: boolean
  labeledCount: number
  /** Number of messages with at least 2 human labels — gates Mode B button. */
  multiLabeledCount?: number
  onDiscover: (queryKind?: ConceptCandidateKind) => void
  onOpenModal: () => void
  discovering: boolean
}

export default function DiscoverSection({
  candidates,
  aiUnlocked,
  labeledCount,
  multiLabeledCount = 0,
  onDiscover,
  onOpenModal,
  discovering,
}: Props) {
  const [ripe, setRipe] = useState<RipeSignal | null>(null)

  // Poll the ripeness signal every 30s while mounted.
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const sig = await api.getConceptRipe()
        if (!cancelled) setRipe(sig)
      } catch {
        /* ignore polling errors */
      }
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const nudgeThresholds = [30, 50, 80]
  const showNudge =
    candidates.length === 0 &&
    nudgeThresholds.some((t) => labeledCount >= t && labeledCount < t + 5)

  if (!aiUnlocked) return null

  const showCoOccurButton = multiLabeledCount >= 2
  const ripeForAny = ripe?.ripe === true

  if (candidates.length > 0) {
    return (
      <div className="mb-3">
        <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-1.5">
          Discover
        </p>
        <button
          onClick={onOpenModal}
          className="w-full text-xs py-1.5 px-2 rounded border border-violet-500/50 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-colors"
        >
          ✦ {candidates.length} suggestion{candidates.length !== 1 ? 's' : ''}
        </button>
      </div>
    )
  }

  return (
    <div className="mb-3">
      <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-1.5">
        Discover
      </p>
      <div className="flex flex-col gap-1.5">
        <button
          onClick={() => onDiscover('broad_label')}
          disabled={discovering}
          className="w-full text-xs py-1.5 px-2 rounded border border-dashed border-violet-500/50 text-violet-300 hover:bg-violet-500/10 transition-colors disabled:opacity-50 disabled:cursor-wait"
        >
          {discovering ? (
            <span className="flex items-center justify-center gap-1.5">
              <span className="inline-block w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
              Discovering...
            </span>
          ) : (
            <>
              ✦ Find missing labels
              {ripeForAny && (
                <span
                  aria-label="discovery is ripe"
                  title={
                    ripe
                      ? `${ripe.pool_size} unlabeled · drift ${ripe.drift_value ?? '–'}`
                      : ''
                  }
                  className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 align-middle"
                />
              )}
              {showNudge && (
                <span className="block text-[10px] text-amber-400 mt-0.5">
                  Some messages may not fit your labels
                </span>
              )}
            </>
          )}
        </button>

        {showCoOccurButton && (
          <button
            onClick={() => onDiscover('co_occurrence')}
            disabled={discovering}
            className="w-full text-xs py-1.5 px-2 rounded border border-dashed border-amber-500/50 text-amber-300 hover:bg-amber-500/10 transition-colors disabled:opacity-50 disabled:cursor-wait"
          >
            ✦ Find label patterns
          </button>
        )}
      </div>
    </div>
  )
}
