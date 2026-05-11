type Props = {
  /** 0–100 weekly yes-rate values, oldest → newest, length ≤ 8 */
  values: number[]
}

const W = 88
const H = 18
const PAD = 2

export function RailSparkline({ values }: Props) {
  if (values.length < 2) {
    return <svg className="block flex-none" width={W} height={H} aria-hidden="true" />
  }
  const inner = W - PAD * 2
  const innerH = H - PAD * 2
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = Math.max(max - min, 1)
  const stepX = inner / (values.length - 1)
  const points = values
    .map((v, i) => {
      const x = PAD + i * stepX
      const y = H - PAD - ((v - min) / range) * innerH
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg
      className="block flex-none"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke="var(--app-moss)"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  )
}
