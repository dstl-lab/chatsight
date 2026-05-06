import type { AssistNeighbor } from '../../types'

interface AssistFlankProps {
  neighbors: AssistNeighbor[]
}

/**
 * Right-side calibration flank for /run. Shows the instructor's k closest
 * already-labeled decisions for the focused message. No confidence chip,
 * no thresholds — pure retrieval evidence.
 */
export function AssistFlank({ neighbors }: AssistFlankProps) {
  if (neighbors.length === 0) {
    return (
      <div className="bg-canvas overflow-y-auto px-7 pt-16 pb-7 flex flex-col">
        <p className="font-serif italic text-[15px] leading-[1.55] text-muted max-w-[240px]">
          Your closest prior decisions will appear here as you label.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-canvas overflow-y-auto px-7 pt-9 pb-7 flex flex-col gap-2">
      <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-faint mb-4">
        your closest prior decisions
      </div>
      <div className="flex flex-col gap-[18px]">
        {neighbors.map((n) => (
          <NeighborRow key={`${n.chatlog_id}-${n.message_index}`} n={n} />
        ))}
      </div>
    </div>
  )
}

function NeighborRow({ n }: { n: AssistNeighbor }) {
  const isYes = n.value === 'yes'
  const dotColor = isYes ? 'bg-moss' : 'bg-brick'
  const verdictColor = isYes ? 'text-moss' : 'text-brick'
  const hoverBorder = isYes ? 'hover:border-l-moss-dim' : 'hover:border-l-brick-dim'

  return (
    <div
      data-testid="neighbor-row"
      className={`px-3 py-2 border-l-2 border-transparent ${hoverBorder} hover:bg-white/[.015] transition-all duration-150 flex flex-col gap-2`}
    >
      <div className="inline-flex items-center gap-2 font-mono text-[9px] tracking-[0.14em] uppercase">
        <span className={`w-[5px] h-[5px] rounded-full ${dotColor}`} />
        <span className={verdictColor}>{n.value}</span>
        <span className="text-faint opacity-60">·</span>
        <span className="text-faint tracking-[0.06em]">sim {n.similarity.toFixed(2)}</span>
      </div>
      <div className="font-serif italic text-[15px] leading-[1.5] text-on-surface line-clamp-2">
        <span className="opacity-40">&ldquo;</span>{n.message_text}<span className="opacity-40">&rdquo;</span>
      </div>
    </div>
  )
}
