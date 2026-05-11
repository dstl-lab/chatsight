import type { ExampleMsg } from '../../../types'

type Props = {
  open: boolean
  onClose: () => void
  runLabel: string
  examples: {
    yes: ExampleMsg[]
    no: ExampleMsg[]
    edge: ExampleMsg[]
  }
  totals: {
    yes: number
    no: number
    edge: number
  }
}

export function ExamplesDrawer({ open, onClose, runLabel, examples, totals }: Props) {
  return (
    <aside
      className="fixed left-[304px] right-0 bottom-0 bg-canvas border-t border-edge transition-[height] duration-[240ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] z-50 flex flex-col overflow-hidden"
      style={{ height: open ? '38vh' : '0px' }}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between px-6 py-2.5 border-b border-edge-warm">
        <h3 className="font-serif font-medium text-sm text-paper">
          Example messages — {runLabel}
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="appearance-none bg-transparent border-0 font-serif text-[12px] text-muted cursor-pointer px-2 py-1 rounded-sm hover:text-paper hover:bg-surface transition-colors"
        >
          close ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-3 grid grid-cols-3 gap-5">
        <Group title="YES — SAMPLED"   shown={examples.yes.length}  total={totals.yes}   msgs={examples.yes} />
        <Group title="NO — SAMPLED"    shown={examples.no.length}   total={totals.no}    msgs={examples.no} />
        <Group title="EDGE — FLAGGED"  shown={examples.edge.length} total={totals.edge}  msgs={examples.edge} variant="edge" />
      </div>
    </aside>
  )
}

function Group({
  title,
  shown,
  total,
  msgs,
  variant = 'default',
}: {
  title: string
  shown: number
  total: number
  msgs: ExampleMsg[]
  variant?: 'default' | 'edge'
}) {
  const isEdge = variant === 'edge'
  return (
    <section>
      <h4
        className={`text-[10.5px] tracking-[0.1em] pb-1.5 border-b border-edge-warm mb-2 flex justify-between items-baseline ${
          isEdge ? 'text-brick' : 'text-ochre'
        }`}
        style={{ fontFeatureSettings: '"smcp", "tnum"' }}
      >
        <span>{title}</span>
        <span
          className="text-muted"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {shown} OF {total}
        </span>
      </h4>
      {msgs.length === 0 ? (
        <p className="italic text-stone text-[11.5px]">— none</p>
      ) : (
        msgs.map((m) => <Item key={m.message_id} m={m} edge={isEdge} />)
      )}
    </section>
  )
}

function Item({ m, edge }: { m: ExampleMsg; edge: boolean }) {
  return (
    <div className="py-2 border-b border-edge-warm last:border-b-0">
      <p className="text-[12.5px] text-paper leading-snug">{m.text}</p>
      <p
        className={`mt-1 text-[10.5px] italic leading-snug ${
          edge && m.flag ? 'text-brick' : 'text-muted'
        }`}
      >
        {m.assignment && (
          <span className="not-italic text-paper">{m.assignment}</span>
        )}
        {m.position_bucket && <> · {m.position_bucket}</>}
        {m.ai_pred !== null && m.ai_confidence !== null && (
          <>
            {' · '}
            <span className="not-italic">
              ai {m.ai_confidence.toFixed(2)} {m.ai_pred}
            </span>
          </>
        )}
        {m.flag === 'low_confidence' && <> — low confidence</>}
        {m.flag === 'human_overruled' && <> — human overruled</>}
        {!m.flag && m.human_decision && (
          <>
            {' · '}
            <span className="not-italic">human {m.human_decision}</span>
          </>
        )}
      </p>
    </div>
  )
}
