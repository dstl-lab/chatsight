type Props = {
  /** 0–100 weekly yes-rate values, oldest → newest, length ≤ 8.
   *  x = week index, y = yes-rate% on an absolute 0–100 scale. */
  values: number[]
}

const W = 88
const H = 18
const PAD = 2

export function RailSparkline({ values }: Props) {
  if (values.length === 0) {
    return <svg className="block flex-none" width={W} height={H} aria-hidden="true" />
  }

  const inner = W - PAD * 2
  const innerH = H - PAD * 2
  // Absolute 0–100% scale on y so positions are comparable across runs.
  const yFor = (v: number) => H - PAD - (Math.max(0, Math.min(100, v)) / 100) * innerH

  // For a single value there's no "between" to draw a line across — place the
  // dot at the midpoint of the available width so the position reads.
  const xFor = (i: number) => {
    if (values.length === 1) return W / 2
    return PAD + (i / (values.length - 1)) * inner
  }

  const xs = values.map((_, i) => xFor(i))
  const ys = values.map(yFor)
  const points = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
  const title = values.map((v, i) => `W${i + 1}: ${v}%`).join(' · ')

  return (
    <svg
      className="block flex-none"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Weekly yes-rate: ${title}`}
    >
      <title>{title}</title>
      {/* Faint 50% baseline so the dot's vertical position is interpretable */}
      <line
        x1={0}
        y1={H / 2}
        x2={W}
        y2={H / 2}
        stroke="var(--app-edge-warm)"
        strokeWidth={0.8}
        strokeDasharray="2 2"
      />
      {values.length > 1 && (
        <polyline
          fill="none"
          stroke="var(--app-moss)"
          strokeWidth={1.4}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points}
        />
      )}
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={1.8} fill="var(--app-moss)" />
      ))}
    </svg>
  )
}
