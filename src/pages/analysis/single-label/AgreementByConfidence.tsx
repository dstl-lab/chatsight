import type { AgreementBucket } from '../../../types'

type Props = {
  buckets: AgreementBucket[]
}

const LABELS = ['.0–.2', '.2–.4', '.4–.6', '.6–.8', '.8–1']

function fillClass(rate: number | null): string {
  if (rate === null) return 'bg-edge-warm'
  if (rate >= 80) return 'bg-moss'
  if (rate >= 65) return 'bg-ochre'
  return 'bg-brick'
}

function gloss(buckets: AgreementBucket[]): string {
  const valid = buckets.filter((b) => b.agreement_rate !== null)
  if (valid.length < 3) return ''
  const first = valid[0].agreement_rate!
  const last = valid[valid.length - 1].agreement_rate!
  const edges = (first + last) / 2
  const middle =
    valid.slice(1, -1).reduce((s, b) => s + (b.agreement_rate ?? 0), 0) /
    Math.max(valid.length - 2, 1)
  if (edges > 80 && middle < 65)
    return 'Most trustworthy at the extremes — the middle bin is a coin flip.'
  if (middle >= 80) return 'Agreement holds across the range.'
  return 'Confidence is loosely correlated with agreement.'
}

export function AgreementByConfidence({ buckets }: Props) {
  const empty = buckets.every((b) => b.overlap_count === 0)
  return (
    <div className="chart-card flex-1 min-h-0 flex flex-col">
      <div className="text-sm font-serif font-medium text-paper">Agreement by confidence</div>
      {empty ? (
        <p className="italic text-stone text-[12px] mt-2 flex-1">
          — no human/AI overlap yet to compute agreement.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-1 items-end flex-1 min-h-0 mt-3">
            {buckets.map((b, i) => (
              <div key={i} className="flex flex-col items-stretch justify-end h-full">
                <div
                  data-testid="agreement-bar"
                  className={`${fillClass(b.agreement_rate)} origin-bottom`}
                  style={{
                    height: `${b.agreement_rate ?? 0}%`,
                    minHeight: b.overlap_count === 0 ? '0' : '2px',
                    animation: `chartBarIn 600ms cubic-bezier(0.2,0.8,0.2,1) ${i * 40}ms backwards`,
                  }}
                />
                {b.agreement_rate !== null && (
                  <div
                    className="mt-1 text-[10px] text-paper text-center font-medium"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {b.agreement_rate}%
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-5 gap-1 mt-1.5 pt-1 border-t border-edge-warm">
            {LABELS.map((l) => (
              <span
                key={l}
                className="text-[9px] text-muted text-center tracking-[0.04em]"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {l}
              </span>
            ))}
          </div>
          <div className="mt-1.5 text-[10.5px] text-muted italic leading-snug">{gloss(buckets)}</div>
        </>
      )}
    </div>
  )
}
