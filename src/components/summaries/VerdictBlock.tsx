import { useState } from 'react'
import type { MessageVerdict } from '../../types'
import { HUMAN_GLYPH, HUMAN_TITLE } from './AppliedByGlyph'

interface VerdictBlockProps {
  verdict: MessageVerdict | null
  confidence: number | null
  appliedBy: 'ai' | 'human' | null
  matchedPattern: string | null
  rationale: string | null
  nearThreshold: boolean
  onAccept: () => void
  onFlip: (newVerdict: 'yes' | 'no') => void
  onFlag: () => void
}

function badgeStyles(v: MessageVerdict | null) {
  if (v === 'yes') return 'bg-[rgba(143,168,118,0.10)] text-moss border-moss-dim'
  if (v === 'no') return 'bg-[rgba(187,92,66,0.10)] text-brick border-brick-dim'
  return 'bg-[rgba(228,181,59,0.10)] text-ochre border-ochre-dim'
}

export function VerdictBlock({
  verdict, confidence, appliedBy, matchedPattern, rationale, nearThreshold,
  onAccept, onFlip, onFlag,
}: VerdictBlockProps) {
  const [whyOpen, setWhyOpen] = useState(false)
  const oppositeVerdict: 'yes' | 'no' = verdict === 'yes' ? 'no' : 'yes'

  return (
    <div className="mt-4 p-3.5 bg-canvas border border-edge rounded-sm">
      <div className="flex items-center gap-2.5 flex-wrap">
        <span className={`inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-sm border font-mono text-[11px] ${badgeStyles(verdict)}`}>
          <strong>{(verdict ?? '').toUpperCase()}</strong>
          {confidence !== null && <span className="text-paper">· {confidence.toFixed(2)}</span>}
        </span>
        {appliedBy === 'human' && (
          <span
            role="img"
            data-testid="verdict-applied-by-human"
            title={HUMAN_TITLE}
            aria-label={HUMAN_TITLE}
            className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted"
          >
            {HUMAN_GLYPH}
            <span className="uppercase tracking-[0.08em]">human</span>
          </span>
        )}
        {matchedPattern && (
          <span className="text-ochre text-[12.5px] underline decoration-dotted underline-offset-[3px] cursor-pointer">"{matchedPattern}"</span>
        )}
        {nearThreshold && (
          <span className="font-mono text-[10.5px] text-faint">near threshold</span>
        )}
        {rationale && (
          <button onClick={() => setWhyOpen(!whyOpen)} className="ml-auto font-mono text-[10px] tracking-[0.12em] uppercase text-muted hover:text-ochre">
            why {whyOpen ? '▴' : '▾'}
          </button>
        )}
      </div>
      {whyOpen && rationale && (
        <div className="mt-2.5 italic font-serif text-[13.5px] text-on-surface leading-[1.55]">
          "{rationale}"
        </div>
      )}
      <div className="mt-3 flex gap-1.5 flex-wrap">
        <button onClick={onAccept} className="px-3 py-1.5 rounded-sm bg-moss-dim border border-moss text-paper font-mono text-[10px] tracking-[0.08em] uppercase">✓ accept</button>
        <button onClick={() => onFlip(oppositeVerdict)} className="px-3 py-1.5 rounded-sm border border-edge text-on-surface font-mono text-[10px] tracking-[0.08em] uppercase hover:text-paper hover:border-paper">↺ flip</button>
        <button onClick={onFlag} className="px-3 py-1.5 rounded-sm border border-ochre-dim text-ochre font-mono text-[10px] tracking-[0.08em] uppercase">⚑ flag</button>
      </div>
    </div>
  )
}
