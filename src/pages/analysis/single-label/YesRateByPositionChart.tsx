import type { SingleLabelRunDetail } from '../../../types'

type Props = {
  rows: SingleLabelRunDetail['by_position']
}

const LABELS: Record<'early' | 'mid' | 'late', string> = {
  early: 'EARLY · 0–2',
  mid: 'MID · 3–6',
  late: 'LATE · 7+',
}

const ORDER: Array<'early' | 'mid' | 'late'> = ['early', 'mid', 'late']

export function YesRateByPositionChart({ rows }: Props) {
  if (rows.length === 0) {
    return <p className="italic text-stone text-[12px]">— no decisions yet.</p>
  }
  const byBucket = Object.fromEntries(rows.map((r) => [r.bucket, r] as const))

  return (
    <div className="grid grid-cols-3 gap-2">
      {ORDER.map((bucket, i) => {
        const r = byBucket[bucket]
        if (!r) {
          return (
            <div key={bucket} className="bg-canvas border border-edge-warm rounded-sm p-2.5">
              <div
                className="text-[10px] text-ochre tracking-[0.1em]"
                style={{ fontFeatureSettings: '"smcp", "tnum"' }}
              >
                {LABELS[bucket]}
              </div>
              <div className="mt-1.5 italic text-stone text-[11.5px]">— no data</div>
            </div>
          )
        }
        return (
          <div key={bucket} className="bg-canvas border border-edge-warm rounded-sm p-2.5">
            <div
              className="text-[10px] text-ochre tracking-[0.1em]"
              style={{ fontFeatureSettings: '"smcp", "tnum"' }}
            >
              {LABELS[bucket]}
            </div>
            <div
              className="font-serif font-medium text-[22px] text-paper leading-none tracking-[-0.018em] mt-0.5"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {r.yes_pct}
              <span className="text-[12px] text-muted ml-px">%</span>
            </div>
            <div className="mt-1.5 h-1 bg-edge-warm rounded-[1px] relative">
              <div
                className="absolute top-0 left-0 bottom-0 bg-moss origin-left"
                style={{
                  width: `${r.yes_pct}%`,
                  animation: `chartBarFill 700ms cubic-bezier(0.2,0.8,0.2,1) ${i * 60}ms backwards`,
                }}
              />
            </div>
            <div className="mt-1.5 text-[10.5px] text-muted italic">n = {r.yes + r.no}</div>
          </div>
        )
      })}
    </div>
  )
}
