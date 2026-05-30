import type { SingleLabelRunDetail } from '../../../types'

type Props = {
  rows: SingleLabelRunDetail['by_hour_of_day']
}

function fillClass(yesPct: number, hasData: boolean): string {
  if (!hasData) return 'bg-edge-warm/60'
  if (yesPct >= 50) return 'bg-moss'
  if (yesPct >= 30) return 'bg-ochre'
  return 'bg-brick/55'
}

function peakWindow(rows: SingleLabelRunDetail['by_hour_of_day']): string {
  // Identify the contiguous 3-hour window with the highest decision count.
  const counts = rows.map((r) => r.yes + r.no)
  const total = counts.reduce((s, n) => s + n, 0)
  if (total === 0) return ''
  let bestStart = 0
  let bestCount = -1
  for (let i = 0; i < 24; i++) {
    const c = counts[i] + counts[(i + 1) % 24] + counts[(i + 2) % 24]
    if (c > bestCount) {
      bestCount = c
      bestStart = i
    }
  }
  if (bestCount === 0) return ''
  const fmt = (h: number) => String(h).padStart(2, '0')
  return `Peak window ${fmt(bestStart)}:00–${fmt((bestStart + 3) % 24)}:00`
}

export function YesRateByHourOfDayChart({ rows }: Props) {
  const total = rows.reduce((s, r) => s + r.yes + r.no, 0)
  if (total === 0) {
    return <p className="italic text-stone text-[12px]">— no time-of-day data yet.</p>
  }

  const peak = peakWindow(rows)

  return (
    <div className="w-full">
      <div
        className="grid gap-[2px] items-end h-[64px]"
        style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
      >
        {rows.map((r) => {
          const hasData = r.yes + r.no > 0
          const heightPct = hasData ? Math.max(r.yes_pct, 3) : 6
          return (
            <div
              key={r.hour}
              className="flex flex-col justify-end h-full"
              title={
                hasData
                  ? `${r.hour}:00 — ${r.yes_pct}% yes (n=${r.yes + r.no})`
                  : `${r.hour}:00 — no decisions`
              }
            >
              <div
                className={fillClass(r.yes_pct, hasData)}
                style={{
                  height: `${heightPct}%`,
                  animation: `chartBarIn 600ms cubic-bezier(0.2,0.8,0.2,1) ${r.hour * 10}ms backwards`,
                }}
              />
            </div>
          )
        })}
      </div>
      <div
        className="grid gap-[2px] mt-1 pt-1 border-t border-edge-warm text-[9px] text-muted text-center tracking-[0.04em]"
        style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))', fontVariantNumeric: 'tabular-nums' }}
      >
        {rows.map((r) => (
          <span key={r.hour}>{r.hour % 6 === 0 ? String(r.hour).padStart(2, '0') : ''}</span>
        ))}
      </div>
      {peak && (
        <p className="mt-1.5 italic text-[11px] text-muted leading-snug">{peak}</p>
      )}
    </div>
  )
}
