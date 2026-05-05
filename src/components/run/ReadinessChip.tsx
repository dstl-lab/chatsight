import { useEffect, useRef, useState } from 'react'
import type { ReadinessState } from '../../types'

interface ReadinessChipProps {
  readiness: ReadinessState
  onHandoff: () => void
}

const tierLabel: Record<ReadinessState['tier'], string> = {
  gray: 'Not ready',
  amber: 'Almost ready',
  green: 'Ready',
}

const tierDot: Record<ReadinessState['tier'], string> = {
  gray: 'bg-faint',
  amber: 'bg-ochre',
  green: 'bg-moss',
}

const tierTitle: Record<ReadinessState['tier'], string> = {
  gray: 'Not ready',
  amber: 'Almost ready',
  green: 'Ready to hand off',
}

const tierBlurb: Record<ReadinessState['tier'], string> = {
  gray:
    'Mark at least one Yes and one No before Gemini can take over. The classifier needs both kinds of example to learn the boundary.',
  amber:
    'You can hand off now, but a few more decisions will give Gemini stronger signal. Walking 5 conversations is the recommended minimum.',
  green:
    'You have enough variety. Hand off whenever you’re ready — Gemini will classify the rest and surface low-confidence cases for review.',
}

export function ReadinessChip({ readiness, onHandoff }: ReadinessChipProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-[11px] py-[5px] rounded-full font-mono text-[11px] tracking-[0.04em] text-muted hover:text-on-canvas transition-colors"
        title="Click to see full readiness"
      >
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${tierDot[readiness.tier]}`} />
        {tierLabel[readiness.tier]}
        <span className="text-faint">·</span>
        <span>{readiness.yes_count}y / {readiness.no_count}n</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-[340px] bg-bg-warm border border-edge rounded-md shadow-2xl overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-edge-subtle">
            <div className={`font-mono text-[10px] tracking-[0.18em] uppercase mb-1.5 ${
              readiness.tier === 'green'
                ? 'text-moss'
                : readiness.tier === 'amber'
                  ? 'text-ochre'
                  : 'text-faint'
            }`}>
              {tierTitle[readiness.tier]}
            </div>
            <div className="font-serif text-[14px] leading-[1.5] text-on-surface">
              {tierBlurb[readiness.tier]}
            </div>
          </div>

          <div className="px-5 pt-4 pb-2">
            <Gauge tier={readiness.tier} />
            <div className="mt-3.5 grid grid-cols-3 gap-3 font-mono text-[11px]">
              <Stat tone="moss" label="Yes" value={readiness.yes_count} />
              <Stat tone="brick" label="No" value={readiness.no_count} />
              <Stat tone="stone" label="Skip" value={readiness.skip_count} />
            </div>
            <div className="mt-3 font-mono text-[10px] tracking-[0.06em] uppercase text-faint">
              {readiness.conversations_walked} of {readiness.total_conversations} conversations walked
            </div>
            {readiness.hint && (
              <div className="mt-3 font-serif text-[13px] text-muted leading-[1.5]">
                {readiness.hint}
              </div>
            )}
          </div>

          <div className="px-5 pb-4 pt-2">
            <button
              onClick={() => {
                onHandoff()
                setOpen(false)
              }}
              disabled={readiness.tier === 'gray'}
              className={`w-full appearance-none border rounded-sm cursor-pointer font-sans font-semibold text-[13px] py-2 transition-all
                ${readiness.tier === 'gray'
                  ? 'border-edge bg-transparent text-faint cursor-not-allowed'
                  : 'border-ochre bg-ochre text-bg-warm hover:brightness-110'}
              `}
            >
              {readiness.tier === 'gray' ? 'Hand off to Gemini' : 'Hand off to Gemini →'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Gauge({ tier }: { tier: ReadinessState['tier'] }) {
  const segments: { lit: boolean; tone: 'gray' | 'amber' | 'moss' }[] = [
    { lit: tier === 'amber' || tier === 'green', tone: 'amber' },
    { lit: tier === 'amber' || tier === 'green', tone: 'amber' },
    { lit: tier === 'green', tone: 'moss' },
  ]
  return (
    <div className="flex gap-1">
      {segments.map((s, i) => (
        <div
          key={i}
          className={`flex-1 h-1.5 rounded-sm ${
            !s.lit
              ? 'bg-edge'
              : s.tone === 'moss'
                ? 'bg-moss'
                : 'bg-ochre'
          }`}
        />
      ))}
    </div>
  )
}

function Stat({
  tone,
  label,
  value,
}: {
  tone: 'moss' | 'brick' | 'stone'
  label: string
  value: number
}) {
  const color = tone === 'moss' ? 'text-moss' : tone === 'brick' ? 'text-brick' : 'text-stone'
  return (
    <div className="flex flex-col items-start">
      <span className={`text-[18px] ${color}`}>{value}</span>
      <span className="text-[9px] tracking-[0.18em] uppercase text-faint">{label}</span>
    </div>
  )
}
