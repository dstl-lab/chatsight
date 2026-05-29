import { useEffect, useMemo, useState } from 'react'
import { api } from '../../../services/api'
import type { MultiLabelCohortRow } from '../../../types'
import { RailSparkline } from '../single-label/RailSparkline'

type Props = {
  selectedLabelId: number | null
  onSelectLabel: (labelId: number) => void
  onLoaded?: (rows: MultiLabelCohortRow[]) => void
}

export function LabelRail({ selectedLabelId, onSelectLabel, onLoaded }: Props) {
  const [rows, setRows] = useState<MultiLabelCohortRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let alive = true
    api
      .getMultiLabelCohort()
      .then((res) => {
        if (!alive) return
        setRows(res.labels)
        onLoaded?.(res.labels)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
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
      <div
        className="px-4.5 pt-3.5 pb-3 flex items-baseline justify-between border-b border-edge-warm"
        style={{ paddingLeft: '18px', paddingRight: '18px' }}
      >
        <h2 className="font-serif font-medium text-sm text-paper tracking-[-0.005em]">
          Multi-label taxonomy
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
          placeholder="filter labels…"
          className="appearance-none w-full bg-canvas border border-edge-warm rounded-sm px-2 py-1.5 font-serif text-[12px] text-paper placeholder:text-faint focus:outline-none focus:border-ochre-dim"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {error && (
          <p
            className="px-4.5 py-3 italic text-brick text-[12px]"
            style={{ paddingLeft: '18px', paddingRight: '18px' }}
          >
            — {error}
          </p>
        )}
        {!error && rows === null && (
          <p
            className="px-4.5 py-3 italic text-stone text-[12px]"
            style={{ paddingLeft: '18px', paddingRight: '18px' }}
          >
            — loading labels
          </p>
        )}
        {!error && rows !== null && rows.length === 0 && (
          <p
            className="px-4.5 py-3 italic text-stone text-[12px]"
            style={{ paddingLeft: '18px', paddingRight: '18px' }}
          >
            — no multi-labels yet.
          </p>
        )}
        {!error && rows !== null && rows.length > 0 && filtered.length === 0 && (
          <p
            className="px-4.5 py-3 italic text-stone text-[12px]"
            style={{ paddingLeft: '18px', paddingRight: '18px' }}
          >
            — no matches for "{filter}"
          </p>
        )}
        <ul className="list-none m-0 p-0">
          {filtered.map((row, i) => (
            <li
              key={row.label_id}
              onClick={() => onSelectLabel(row.label_id)}
              className={`relative px-4.5 py-3 cursor-pointer border-b border-edge-warm transition-colors hover:bg-elevated ${
                row.label_id === selectedLabelId ? 'bg-elevated' : ''
              }`}
              style={{
                paddingLeft: '18px',
                paddingRight: '18px',
                animation: `railRowIn 320ms ease ${30 + i * 30}ms backwards`,
              }}
            >
              {row.label_id === selectedLabelId && (
                <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-0.5 bg-ochre" />
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
                <Pill v={String(row.human_count)} lbl="HUMAN" />
                <Pill v={String(row.ai_count)} lbl="AI" />
                {row.high_conf_pct != null && (
                  <Pill
                    v={`${row.high_conf_pct}%`}
                    lbl="HI CONF"
                    warn={row.high_conf_pct < 70}
                  />
                )}
              </div>
              <div
                className="mt-2 flex items-center justify-between text-[10.5px] text-muted tracking-[0.08em]"
                style={{ fontFeatureSettings: '"smcp", "tnum"' }}
              >
                <span>{row.total_count} messages</span>
                <RailSparkline values={row.weekly_sparkline} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

function Pill({ v, lbl, warn }: { v: string; lbl: string; warn?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <span className={`text-[12px] font-medium ${warn ? 'text-brick' : 'text-paper'}`}>{v}</span>
      <span
        className={`text-[10px] tracking-[0.08em] ${warn ? 'text-brick' : 'text-muted'}`}
        style={{ fontFeatureSettings: '"smcp", "tnum"' }}
      >
        {lbl}
      </span>
    </span>
  )
}
