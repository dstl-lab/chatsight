import type { ConfidenceBin } from '../../../types'

type Props = {
  histogram: {
    bins: ConfidenceBin[]
    coverage: { with_confidence: number; total_ai: number }
  }
}

function describeShape(bins: ConfidenceBin[]): string {
  if (bins.length < 3) return ''
  const total = bins.reduce((s, b) => s + b.count, 0)
  if (total === 0) return ''
  const low = bins.slice(0, 3).reduce((s, b) => s + b.count, 0) / total
  const mid = bins.slice(3, 7).reduce((s, b) => s + b.count, 0) / total
  const high = bins.slice(7).reduce((s, b) => s + b.count, 0) / total
  if (low > 0.3 && high > 0.3 && mid < 0.25) return 'bimodal — the model is decisive on this concept'
  if (mid > 0.5) return 'mass near the middle — the model is hesitating'
  if (high > 0.5) return 'mass near 1 — the model is confident this label applies'
  if (low > 0.5) return 'mass near 0 — the model is confident this label does not apply'
  return 'mixed distribution'
}

export function ConfidenceHistogram({ histogram }: Props) {
  const { bins, coverage } = histogram

  if (bins.length === 0 || coverage.total_ai === 0) {
    return (
      <div className="chart-card flex-1 min-h-0 flex flex-col">
        <div className="text-sm font-serif font-medium text-paper">Confidence distribution</div>
        <p className="italic text-stone mt-2 text-[13px]">— no AI predictions yet for this run.</p>
      </div>
    )
  }

  const maxCount = Math.max(...bins.map((b) => b.count), 1)
  const excluded = coverage.total_ai - coverage.with_confidence
  const shape = describeShape(bins)

  return (
    <div className="chart-card flex-1 min-h-0 flex flex-col">
      <div className="flex items-baseline justify-between mb-3.5">
        <div>
          <div className="text-sm font-serif font-medium text-paper">Confidence distribution</div>
          <div className="text-[11.5px] italic text-muted mt-0.5">
            {coverage.with_confidence} AI predictions{shape && ` · ${shape}`}
          </div>
        </div>
        <div
          className="inline-flex gap-3.5 text-[10.5px] text-muted tracking-[0.08em]"
          style={{ fontFeatureSettings: '"smcp", "tnum"' }}
        >
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 bg-moss" />YES
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 bg-brick" />NO
          </span>
        </div>
      </div>

      <div
        className="grid grid-cols-10 gap-2 items-end flex-1 min-h-0"
        role="img"
        aria-label="Confidence histogram"
      >
        {bins.map((b, i) => {
          const stackH = (b.count / maxCount) * 100
          const yesShare = b.count === 0 ? 0 : (b.yes / b.count) * 100
          const noShare = 100 - yesShare
          return (
            <div key={i} data-testid="hist-bin" className="flex flex-col justify-end h-full">
              <div
                className="flex flex-col origin-bottom"
                style={{
                  height: `${stackH}%`,
                  animation: `chartBarIn 600ms cubic-bezier(0.2,0.8,0.2,1) ${i * 30}ms backwards`,
                }}
              >
                <div className="bg-brick" style={{ height: `${noShare}%` }} />
                <div className="bg-moss" style={{ height: `${yesShare}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-10 gap-2 mt-2 pt-2 border-t border-edge-warm">
        {bins.map((_, i) => (
          <span
            key={i}
            className="text-[10px] text-muted text-center tracking-[0.04em]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {`.${i}`}
          </span>
        ))}
      </div>

      <div className="mt-2.5 flex items-baseline justify-between text-[11.5px] italic text-muted">
        <span>Bins of 0.1 confidence · AI rows only</span>
        <span>
          coverage: {coverage.with_confidence} / {coverage.total_ai}
        </span>
      </div>
      {excluded > 0 && (
        <p className="mt-1 italic text-[11px] text-stone">
          ({excluded} AI rows lacking confidence excluded.)
        </p>
      )}
    </div>
  )
}
