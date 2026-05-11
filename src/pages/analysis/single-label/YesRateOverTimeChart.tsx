import type { SingleLabelRunDetail } from '../../../types'

type Props = {
  weeks: SingleLabelRunDetail['weekly']
}

const W = 800
const H = 90
const PAD_LEFT = 40
const PAD_RIGHT = 16

function weekLabel(iso: string): string {
  const d = new Date(iso)
  const oneJan = new Date(d.getFullYear(), 0, 1)
  const wk = Math.ceil(((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7)
  return `W${wk}`
}

export function YesRateOverTimeChart({ weeks }: Props) {
  if (weeks.length === 0) {
    return <p className="italic text-stone text-[12px]">— not enough history yet.</p>
  }

  const innerW = W - PAD_LEFT - PAD_RIGHT
  const xs = weeks.map((_, i) => PAD_LEFT + (i / Math.max(weeks.length - 1, 1)) * innerW)
  const ysYes = weeks.map((wk) => H - 15 - (wk.yes_pct / 100) * (H - 30))
  const maxN = Math.max(...weeks.map((wk) => wk.yes + wk.no), 1)
  const ysN = weeks.map((wk) => H - 25 - ((wk.yes + wk.no) / maxN) * (H - 50))

  const points = (ys: number[]) => xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full h-[90px]">
        <line
          x1={0}
          y1={H / 2}
          x2={W}
          y2={H / 2}
          stroke="var(--app-edge-warm)"
          strokeWidth={1}
          strokeDasharray="2 4"
        />
        <polyline
          fill="none"
          stroke="var(--app-moss)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points(ysYes)}
        />
        <polyline
          fill="none"
          stroke="var(--app-ochre-dim)"
          strokeWidth={1.4}
          strokeDasharray="3 4"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points(ysN)}
        />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ysYes[i]} r={2.2} fill="var(--app-moss)" />
        ))}
      </svg>
      <div
        className="grid mt-1 text-[9.5px] text-muted text-center tracking-[0.06em]"
        style={{
          gridTemplateColumns: `repeat(${weeks.length}, 1fr)`,
          fontFeatureSettings: '"smcp", "tnum"',
        }}
      >
        {weeks.map((wk) => (
          <span key={wk.week_start}>{weekLabel(wk.week_start)}</span>
        ))}
      </div>
      <div
        className="mt-2 flex gap-3.5 text-[10px] text-muted tracking-[0.06em]"
        style={{ fontFeatureSettings: '"smcp", "tnum"' }}
      >
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-4 h-[1.5px] bg-moss align-middle" />
          YES RATE
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block w-4 align-middle"
            style={{ borderTop: '1.5px dotted var(--app-ochre-dim)' }}
          />
          N PER WEEK
        </span>
      </div>
    </div>
  )
}
