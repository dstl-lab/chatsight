import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../services/api'
import type { SingleLabelCohortRow } from '../../../types'
import { RailSparkline } from './RailSparkline'

const DISAGREE_THRESHOLD = 15

type Props = {
  selectedRunId: number | null
  onSelectRun: (runId: number) => void
  /** Notify the shell when the cohort first loads (used to default-select the most-recent run). */
  onLoaded?: (rows: SingleLabelCohortRow[]) => void
}

export function CohortRail({ selectedRunId, onSelectRun, onLoaded }: Props) {
  const [rows, setRows] = useState<SingleLabelCohortRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    api
      .getSingleLabelCohort()
      .then((res) => {
        if (!alive) return
        setRows(res.runs)
        onLoaded?.(res.runs)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
    // onLoaded is intentionally excluded — fire-once semantics on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.label_name.toLowerCase().includes(q))
  }, [rows, filter])

  return (
    <aside
      className="border-r border-edge-warm bg-surface flex flex-col min-h-0"
      style={{ width: '304px' }}
    >
      <div className="px-4.5 pt-3.5 pb-3 flex items-baseline justify-between border-b border-edge-warm" style={{ paddingLeft: '18px', paddingRight: '18px' }}>
        <h2 className="font-serif font-medium text-sm text-paper tracking-[-0.005em]">
          Single-label runs
        </h2>
        <span
          className="text-[10.5px] text-muted tracking-[0.1em]"
          style={{ fontFeatureSettings: '"smcp", "tnum"' }}
        >
          {rows?.length ?? '—'}
        </span>
      </div>

      <div className="px-3 py-2 border-b border-edge-warm">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter runs…"
          className="appearance-none w-full bg-canvas border border-edge-warm rounded-sm px-2 py-1.5 font-serif text-[12px] text-paper placeholder:text-faint focus:outline-none focus:border-ochre-dim"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {error && (
          <p className="px-4.5 py-3 italic text-brick text-[12px]" style={{ paddingLeft: '18px', paddingRight: '18px' }}>
            — {error}
          </p>
        )}
        {!error && rows === null && (
          <p className="px-4.5 py-3 italic text-stone text-[12px]" style={{ paddingLeft: '18px', paddingRight: '18px' }}>
            — loading runs
          </p>
        )}
        {!error && rows !== null && rows.length === 0 && (
          <p className="px-4.5 py-3 italic text-stone text-[12px]" style={{ paddingLeft: '18px', paddingRight: '18px' }}>
            — no single-label runs yet.
          </p>
        )}
        {!error && rows !== null && rows.length > 0 && filtered.length === 0 && (
          <p className="px-4.5 py-3 italic text-stone text-[12px]" style={{ paddingLeft: '18px', paddingRight: '18px' }}>
            — no matches for "{filter}"
          </p>
        )}
        <ul className="list-none m-0 p-0">
          {filtered.map((row, i) => (
            <Entry
              key={row.run_id}
              row={row}
              selected={row.run_id === selectedRunId}
              index={i}
              onClick={() => onSelectRun(row.run_id)}
            />
          ))}
        </ul>
      </div>
    </aside>
  )
}

function Entry({
  row,
  selected,
  index,
  onClick,
}: {
  row: SingleLabelCohortRow
  selected: boolean
  index: number
  onClick: () => void
}) {
  const warn = (row.disagreement_pct ?? 0) >= DISAGREE_THRESHOLD
  return (
    <li
      onClick={onClick}
      className={`relative px-4.5 py-3 cursor-pointer border-b border-edge-warm transition-colors hover:bg-elevated ${
        selected ? 'bg-elevated' : ''
      }`}
      style={{
        paddingLeft: '18px',
        paddingRight: '18px',
        animation: `railRowIn 320ms ease ${30 + index * 30}ms backwards`,
      }}
    >
      {selected && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 bottom-0 w-0.5 bg-ochre"
        />
      )}
      <div className="font-serif font-medium text-[14.5px] text-paper tracking-[-0.005em]">
        {row.label_name}
      </div>
      {row.description && (
        <div className="mt-0.5 text-[11.5px] text-muted leading-snug truncate">
          {row.description}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2.5 text-[11px] text-muted">
        <Pill v={`${row.yes_pct}%`} lbl="YES" />
        <Pill v={`${row.disagreement_pct ?? '—'}%`} lbl="DIS" warn={warn} />
        <Pill v={row.total_target ? `${row.walked}/${row.total_target}` : `${row.walked}`} />
      </div>
      <div
        className="mt-2 flex items-center justify-between text-[10.5px] text-muted tracking-[0.08em]"
        style={{ fontFeatureSettings: '"smcp", "tnum"' }}
      >
        <span className="inline-flex items-center gap-1.5">
          <PhaseDot phase={row.phase} />
          {row.phase.toUpperCase()}
        </span>
        <RailSparkline values={row.weekly_sparkline} />
      </div>
    </li>
  )
}

function Pill({ v, lbl, warn }: { v: string; lbl?: string; warn?: boolean }) {
  return (
    <span
      className="inline-flex items-baseline gap-1"
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      <span className={`text-[12px] font-medium ${warn ? 'text-brick' : 'text-paper'}`}>
        {v}
      </span>
      {lbl && (
        <span
          className={`text-[10px] tracking-[0.08em] ${warn ? 'text-brick' : 'text-muted'}`}
          style={{ fontFeatureSettings: '"smcp", "tnum"' }}
        >
          {lbl}
        </span>
      )}
    </span>
  )
}

function PhaseDot({ phase }: { phase: SingleLabelCohortRow['phase'] }) {
  if (phase === 'complete') {
    return <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-moss" />
  }
  if (phase === 'labeling') {
    return <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-ochre" />
  }
  if (phase === 'reviewing') {
    return <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full border border-ochre bg-transparent" />
  }
  return <span aria-hidden="true" className="inline-block w-1.5 h-1.5 rounded-full bg-stone opacity-50" />
}
