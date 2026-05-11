import type { SingleLabelRunDetail } from '../../../types'

type Props = {
  rows: SingleLabelRunDetail['by_assignment']
}

function fillColor(pct: number): string {
  if (pct >= 50) return 'bg-moss'
  if (pct >= 30) return 'bg-moss-dim'
  return 'bg-moss/55'
}

export function YesRateByAssignmentChart({ rows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="italic text-stone text-[12px]">— no assignment data yet.</p>
    )
  }

  const sorted = [...rows].sort((a, b) => b.yes_pct - a.yes_pct)

  return (
    <div
      className="grid gap-x-2.5 gap-y-1.5 items-center text-[12px] w-full"
      style={{ gridTemplateColumns: 'minmax(0, 140px) minmax(0, 1fr) 56px' }}
    >
      {sorted.map((r, i) => (
        <div className="contents" key={r.key}>
          <div className="min-w-0 text-[12.5px] text-paper truncate" title={r.key}>
            {r.key}
          </div>
          <div className="relative h-2 bg-edge-warm rounded-[1px] min-w-0">
            <div
              className={`absolute top-0 left-0 bottom-0 origin-left ${fillColor(r.yes_pct)}`}
              style={{
                width: `${r.yes_pct}%`,
                animation: `chartBarFill 700ms cubic-bezier(0.2,0.8,0.2,1) ${i * 40}ms backwards`,
              }}
            />
          </div>
          <div
            className="text-right text-[12.5px] text-paper whitespace-nowrap"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {r.yes_pct}%
            <sup
              className="ml-1 text-[9px] text-muted tracking-[0.04em]"
              style={{ fontFeatureSettings: '"smcp", "tnum"' }}
            >
              {r.yes + r.no}
            </sup>
          </div>
        </div>
      ))}
    </div>
  )
}
