import type { SingleLabelRunDetail } from '../../../types'

type Props = {
  coverage: SingleLabelRunDetail['ai_coverage']
}

const fmt = (n: number) => n.toLocaleString('en-US')

export function CoverageCard({ coverage }: Props) {
  const uncov = Math.max(coverage.total - coverage.covered, 0)
  return (
    <div className="chart-card">
      <div className="text-sm font-serif font-medium text-paper">AI coverage</div>
      <div className="flex items-baseline justify-between mt-2">
        <span
          className="font-serif font-medium text-[22px] text-paper leading-none tracking-[-0.018em]"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {coverage.pct}
          <span className="text-[13px] text-muted ml-px">%</span>
        </span>
        <span
          className="text-[11px] text-muted italic"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {fmt(coverage.covered)} / {fmt(coverage.total)}
        </span>
      </div>
      <div className="mt-2 h-1.5 bg-edge-warm rounded-[1px] relative overflow-hidden">
        <div
          className="absolute top-0 left-0 bottom-0 bg-ochre origin-left"
          style={{
            width: `${coverage.pct}%`,
            animation: 'chartBarFill 700ms cubic-bezier(0.2,0.8,0.2,1) backwards',
          }}
        />
      </div>
      <div
        className="mt-2 flex gap-3 items-baseline text-[10.5px] text-muted tracking-[0.08em]"
        style={{ fontFeatureSettings: '"smcp", "tnum"' }}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 bg-ochre align-middle" />
          AI <span className="text-paper font-medium">{fmt(coverage.covered)}</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 bg-edge-warm border border-edge align-middle" />
          UNCOV <span className="text-paper font-medium">{fmt(uncov)}</span>
        </span>
      </div>
    </div>
  )
}
