import type { SingleLabelRunDetail } from '../../../types'

type Props = {
  disagreement: SingleLabelRunDetail['disagreement']
  threshold?: number
}

export function DisagreementCallout({ disagreement, threshold = 15 }: Props) {
  if (disagreement.overlap_count === 0) {
    return (
      <div className="chart-card mt-3.5">
        <p className="italic text-stone text-[13px]">
          — no human/AI overlap yet. Disagreement becomes computable once the AI has predicted on
          messages you've also decided.
        </p>
      </div>
    )
  }

  const { rate, disagree, overlap_count, breakdown } = disagreement
  const above = rate !== null && rate >= threshold

  return (
    <div className="grid grid-cols-3 border border-edge-warm rounded-sm bg-canvas mt-3.5">
      <Cell label="DISAGREEMENT">
        <span
          className="font-serif font-medium text-[28px] text-paper leading-none tracking-[-0.02em]"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {rate}
          <span className="text-[14px] text-muted ml-px">%</span>
          <span
            className="ml-1.5 text-[11px] text-muted italic font-normal align-[4px]"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {disagree} / {overlap_count}
          </span>
        </span>
        <p className={`mt-1.5 italic text-[11.5px] ${above ? 'text-brick' : 'text-muted'}`}>
          {above
            ? `above the ${threshold}% drift threshold.`
            : `below the ${threshold}% drift threshold.`}
        </p>
      </Cell>
      <Cell label="AI YES · HUMAN NO" border>
        <span
          className="font-serif font-medium text-[28px] text-paper leading-none"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {breakdown.ai_yes_human_no}
        </span>
        <p className="mt-1.5 italic text-[11.5px] text-muted">
          model over-applies on edge cases.
        </p>
      </Cell>
      <Cell label="AI NO · HUMAN YES" border>
        <span
          className="font-serif font-medium text-[28px] text-paper leading-none"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {breakdown.ai_no_human_yes}
        </span>
        <p className="mt-1.5 italic text-[11.5px] text-muted">
          model misses softer cases.
        </p>
      </Cell>
    </div>
  )
}

function Cell({
  label,
  children,
  border,
}: {
  label: string
  children: React.ReactNode
  border?: boolean
}) {
  return (
    <div className={`px-4 py-3.5 ${border ? 'border-l border-edge-warm' : ''}`}>
      <div
        className="text-[10px] text-ochre tracking-[0.12em]"
        style={{ fontFeatureSettings: '"smcp", "tnum"' }}
      >
        {label}
      </div>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}
