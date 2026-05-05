import type { SingleLabel } from '../../types'

interface QueueLineProps {
  queued: SingleLabel[]
  onAdd: () => void
}

export function QueueLine({ queued, onAdd }: QueueLineProps) {
  return (
    <div className="flex items-baseline gap-3 px-12 pb-4 font-serif text-[13px] text-faint tracking-[-0.005em] border-b border-edge-subtle">
      <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-faint shrink-0">
        Up next
      </span>
      <span className="flex flex-wrap gap-0 flex-1">
        {queued.length === 0 ? (
          <span className="text-faint italic">— nothing queued —</span>
        ) : (
          queued.map((q, i) => (
            <span key={q.id} className="flex items-baseline">
              {i > 0 && <span className="text-faint mx-1.5 not-italic">·</span>}
              <button className="text-on-surface hover:text-on-canvas py-0.5 border-b border-dashed border-transparent hover:border-faint transition-colors">
                {q.name}
              </button>
            </span>
          ))
        )}
      </span>
      <button
        onClick={onAdd}
        className="ml-auto font-mono text-[10px] tracking-[0.04em] text-muted hover:text-ochre transition-colors"
      >
        + note a label{' '}
        <span className="text-faint border border-edge px-[5px] py-px rounded-sm text-[9px] ml-2">
          L
        </span>
      </button>
    </div>
  )
}
