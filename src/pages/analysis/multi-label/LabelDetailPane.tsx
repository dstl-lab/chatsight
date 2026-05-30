import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import type { MultiLabelDetail, MultiLabelExampleMsg } from '../../../types'
import { CoverageCard } from '../single-label/CoverageCard'

type Subtab = 'health' | 'findings'

type Props = {
  labelId: number | null
}

export function LabelDetailPane({ labelId }: Props) {
  const [detail, setDetail] = useState<MultiLabelDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subtab, setSubtab] = useState<Subtab>('health')
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (labelId == null) {
      setDetail(null)
      setError(null)
      return
    }
    let alive = true
    setError(null)
    setDetail(null)
    api
      .getMultiLabelDetail(labelId)
      .then((d) => {
        if (alive) setDetail(d)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [labelId])

  useEffect(() => {
    setDrawerOpen(false)
  }, [labelId])

  if (labelId == null) {
    return (
      <section className="flex-1 flex items-center justify-center text-muted italic text-[13px]">
        Pick a label to read.
      </section>
    )
  }
  if (error) {
    return (
      <section className="flex-1 flex items-center justify-center text-brick italic text-[13px]">
        — {error}
      </section>
    )
  }
  if (!detail) {
    return (
      <section className="flex-1 flex items-center justify-center text-stone italic text-[13px]">
        — loading label
      </section>
    )
  }

  const exampleTotals = {
    human: detail.examples.human.length,
    low: detail.examples.low_confidence.length,
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-edge-warm">
        <div className="flex items-baseline gap-3.5 min-w-0">
          <span
            className="text-[10.5px] text-ochre tracking-[0.12em]"
            style={{ fontFeatureSettings: '"smcp", "tnum"' }}
          >
            LABEL
          </span>
          <span className="font-serif font-medium text-[22px] text-paper tracking-[-0.012em] truncate">
            {detail.label.label_name}
          </span>
          <span className="text-[12px] text-muted italic ml-1 truncate">
            human{' '}
            <span className="not-italic text-paper" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {detail.label.human_count}
            </span>{' '}
            <span className="opacity-60">msgs</span> / AI{' '}
            <span className="not-italic text-paper" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {detail.label.ai_count}
            </span>{' '}
            <span className="opacity-60">msgs</span>
            {detail.label.human_pct != null && (
              <>
                <span className="text-ochre-dim mx-2">·</span>
                <span className="not-italic text-paper" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {detail.label.human_pct}%
                </span>{' '}
                human-sourced
              </>
            )}
          </span>
        </div>
        {detail.paired_single_label && (
          <span className="font-mono text-[10px] text-ochre border border-ochre-dim rounded-sm px-2 py-0.5 shrink-0">
            promoted to /run
          </span>
        )}
      </header>

      <nav className="flex items-stretch px-6 border-b border-edge-warm" role="tablist">
        <SubtabBtn selected={subtab === 'health'} onClick={() => setSubtab('health')} label="Label health" count={2} />
        <SubtabBtn selected={subtab === 'findings'} onClick={() => setSubtab('findings')} label="Findings" count={4} />
      </nav>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {subtab === 'health' && <HealthSubtab detail={detail} />}
        {subtab === 'findings' && <FindingsSubtab detail={detail} onOpenExamples={() => setDrawerOpen(true)} />}
      </div>

      <ExamplesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        labelName={detail.label.label_name}
        examples={detail.examples}
        totals={exampleTotals}
      />
    </section>
  )
}

function SubtabBtn(props: { selected: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.selected}
      onClick={props.onClick}
      className={`appearance-none bg-transparent border-0 font-serif text-[13px] cursor-pointer px-4 py-3 -mb-px inline-flex items-baseline gap-2 transition-colors ${
        props.selected
          ? 'text-paper border-b-2 border-ochre'
          : 'text-muted border-b-2 border-transparent hover:text-paper'
      }`}
    >
      {props.label}
      <span
        className="text-[10.5px] text-muted bg-surface rounded-sm px-1.5 py-px"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {props.count}
      </span>
    </button>
  )
}

function HealthSubtab({ detail }: { detail: MultiLabelDetail }) {
  const { bins, coverage } = detail.confidence_histogram
  const maxCount = Math.max(...bins.map((b) => b.count), 1)

  return (
    <div
      className="flex-1 min-h-0 px-6 py-4 grid gap-3.5 overflow-hidden"
      style={{ gridTemplateColumns: '1fr 252px', gridTemplateRows: '1fr auto' }}
    >
      <div style={{ gridColumn: 1, gridRow: 1 }} className="min-h-0 flex flex-col">
        <div className="chart-card flex-1 min-h-0 flex flex-col">
          <div className="text-sm font-serif font-medium text-paper">AI confidence distribution</div>
          <div className="text-[11.5px] italic text-muted mt-0.5 mb-3.5">
            {coverage.total_ai === 0
              ? 'No AI applications yet for this label.'
              : `${coverage.with_confidence} AI predictions with confidence scores`}
          </div>
          {coverage.total_ai > 0 && (
            <>
              <div className="grid grid-cols-10 gap-2 items-end flex-1 min-h-0" role="img" aria-label="Confidence histogram">
                {bins.map((b, i) => (
                  <div key={i} className="flex flex-col justify-end h-full">
                    <div
                      className="bg-ochre origin-bottom"
                      style={{
                        height: `${(b.count / maxCount) * 100}%`,
                        animation: `chartBarIn 600ms cubic-bezier(0.2,0.8,0.2,1) ${i * 30}ms backwards`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-10 gap-2 mt-2 pt-2 border-t border-edge-warm">
                {bins.map((_, i) => (
                  <span key={i} className="text-[10px] text-muted text-center" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    .{i}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div style={{ gridColumn: 2, gridRow: 1 }} className="flex flex-col gap-3 min-h-0">
        <ProvenanceCard provenance={detail.provenance} />
        <CoverageCard
          coverage={{
            covered: detail.label.ai_count,
            total: detail.label.total_count,
            pct: detail.label.total_count > 0
              ? Math.round((detail.label.ai_count / detail.label.total_count) * 100)
              : 0,
          }}
        />
      </div>
      <div style={{ gridColumn: '1 / -1', gridRow: 2 }}>
        {detail.paired_single_label ? (
          <div className="chart-card flex items-baseline justify-between gap-4">
            <div>
              <div className="text-sm font-serif font-medium text-paper">Promoted single-label run</div>
              <div className="text-[12px] text-muted italic mt-1">
                {detail.paired_single_label.label_name} is in /run phase{' '}
                <span className="text-paper not-italic">{detail.paired_single_label.phase}</span>
              </div>
            </div>
            <div className="font-mono text-[11px] text-muted tracking-wide">
              YES {detail.paired_single_label.yes} · NO {detail.paired_single_label.no} · SKIP {detail.paired_single_label.skip}
            </div>
          </div>
        ) : (
          <div className="chart-card text-[12px] text-muted italic">
            This label has not been promoted to a single-label /run validation yet.
          </div>
        )}
      </div>
    </div>
  )
}

function ProvenanceCard({ provenance }: { provenance: MultiLabelDetail['provenance'] }) {
  const total = provenance.human_applications + provenance.ai_applications
  return (
    <div className="chart-card">
      <div className="text-sm font-serif font-medium text-paper">Provenance split</div>
      <div className="mt-2 h-1.5 bg-edge-warm rounded-[1px] flex overflow-hidden">
        {total > 0 && (
          <>
            <div className="bg-ochre/80" style={{ width: `${(provenance.human_applications / total) * 100}%` }} />
            <div className="bg-stone/60" style={{ width: `${(provenance.ai_applications / total) * 100}%` }} />
          </>
        )}
      </div>
      <div className="mt-2 flex gap-3 text-[10.5px] text-muted tracking-[0.08em]" style={{ fontFeatureSettings: '"smcp", "tnum"' }}>
        <span>HUMAN <span className="text-paper font-medium">{provenance.human_applications}</span></span>
        <span>AI <span className="text-paper font-medium">{provenance.ai_applications}</span></span>
      </div>
    </div>
  )
}

function FindingsSubtab({
  detail,
  onOpenExamples,
}: {
  detail: MultiLabelDetail
  onOpenExamples: () => void
}) {
  const maxPos = Math.max(...detail.position_distribution.map((p) => p.count), 1)
  const maxAssn = Math.max(...detail.by_assignment.map((a) => a.total), 1)
  const maxHour = Math.max(...detail.by_hour_of_day.map((h) => h.count), 1)

  return (
    <div
      className="flex-1 min-h-0 px-6 py-4 grid gap-3.5 overflow-y-auto"
      style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: 'auto auto auto' }}
    >
      <div className="chart-card min-h-0">
        <div className="text-sm font-serif font-medium text-paper mb-3">By assignment</div>
        <div className="flex flex-col gap-2">
          {detail.by_assignment.slice(0, 8).map((row) => (
            <div key={row.key} className="flex items-center gap-2 text-[11px]">
              <span className="w-24 truncate text-muted shrink-0">{row.key}</span>
              <div className="flex-1 h-2 bg-edge-warm rounded-sm flex overflow-hidden">
                <div className="bg-ochre/80" style={{ width: `${(row.human / maxAssn) * 100}%` }} />
                <div className="bg-stone/50" style={{ width: `${(row.ai / maxAssn) * 100}%` }} />
              </div>
              <span className="text-muted tabular-nums w-8 text-right">{row.total}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card min-h-0">
        <div className="text-sm font-serif font-medium text-paper mb-3">Conversation position</div>
        <div className="flex flex-col gap-2">
          {detail.position_distribution.map((row) => (
            <div key={row.bucket} className="flex items-center gap-2 text-[11px]">
              <span className="w-12 text-muted uppercase tracking-wide">{row.bucket}</span>
              <div className="flex-1 h-2 bg-edge-warm rounded-sm overflow-hidden">
                <div
                  className="h-full bg-ochre origin-left"
                  style={{ width: `${(row.count / maxPos) * 100}%` }}
                />
              </div>
              <span className="text-muted tabular-nums w-10 text-right">{row.pct}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="chart-card min-h-0">
        <div className="text-sm font-serif font-medium text-paper mb-3">Co-occurring labels</div>
        {detail.co_occurring_labels.length === 0 ? (
          <p className="text-[12px] text-muted italic">No co-labels on the same messages yet.</p>
        ) : (
          <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
            {detail.co_occurring_labels.map((row) => (
              <li key={row.label_name} className="flex items-baseline justify-between text-[12px]">
                <span className="text-paper truncate">{row.label_name}</span>
                <span className="text-muted tabular-nums shrink-0 ml-2">
                  {row.count} ({row.pct}%)
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="chart-card min-h-0">
        <div className="text-sm font-serif font-medium text-paper mb-3">By hour of day</div>
        <div className="grid grid-cols-12 gap-1 items-end h-16">
          {detail.by_hour_of_day.filter((h) => h.hour >= 8 && h.hour <= 22).map((row) => (
            <div key={row.hour} className="flex flex-col justify-end h-full items-center gap-0.5">
              <div
                className="w-full bg-ochre/70 rounded-sm"
                style={{ height: `${(row.count / maxHour) * 100}%`, minHeight: row.count > 0 ? 2 : 0 }}
              />
              <span className="text-[8px] text-faint">{row.hour}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenExamples}
        style={{ gridColumn: '1 / -1' }}
        className="appearance-none bg-canvas border border-edge-warm rounded-sm px-4 py-2.5 flex items-center justify-between text-[12px] text-paper cursor-pointer hover:bg-elevated transition-colors"
      >
        <span className="inline-flex gap-3 items-baseline">
          <strong className="font-serif font-medium">Example messages</strong>
          <ExPill v={detail.examples.human.length} lbl="HUMAN" />
          <ExPill v={detail.examples.low_confidence.length} lbl="LOW CONF" />
        </span>
        <span className="text-ochre">▸</span>
      </button>
    </div>
  )
}

function ExPill({ v, lbl }: { v: number; lbl: string }) {
  return (
    <span className="text-[10.5px] text-muted tracking-[0.08em]" style={{ fontFeatureSettings: '"smcp", "tnum"' }}>
      {lbl}{' '}
      <span className="text-paper font-medium ml-0.5" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {v}
      </span>
    </span>
  )
}

function ExamplesDrawer({
  open,
  onClose,
  labelName,
  examples,
  totals,
}: {
  open: boolean
  onClose: () => void
  labelName: string
  examples: MultiLabelDetail['examples']
  totals: { human: number; low: number }
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button type="button" className="flex-1 bg-black/40" aria-label="Close examples" onClick={onClose} />
      <aside className="w-[420px] max-w-full bg-surface border-l border-edge-warm flex flex-col shadow-xl">
        <header className="px-5 py-4 border-b border-edge-warm flex items-baseline justify-between">
          <div>
            <div className="font-serif font-medium text-paper">{labelName}</div>
            <div className="text-[11px] text-muted italic mt-0.5">Example messages</div>
          </div>
          <button type="button" onClick={onClose} className="text-muted hover:text-paper text-lg leading-none">
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-5">
          <ExampleSection title="Human-labeled" items={examples.human} empty="No human examples yet." />
          <ExampleSection title="Low-confidence AI" items={examples.low_confidence} empty="No low-confidence AI rows." />
        </div>
        <footer className="px-5 py-3 border-t border-edge-warm text-[10px] text-muted tracking-wide">
          HUMAN {totals.human} · LOW CONF {totals.low}
        </footer>
      </aside>
    </div>
  )
}

function ExampleSection({
  title,
  items,
  empty,
}: {
  title: string
  items: MultiLabelExampleMsg[]
  empty: string
}) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-faint mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-[12px] text-muted italic">{empty}</p>
      ) : (
        <ul className="list-none m-0 p-0 flex flex-col gap-3">
          {items.map((ex) => (
            <li key={ex.message_id} className="border border-edge-warm rounded-sm p-3 bg-canvas">
              <p className="font-serif text-[13px] text-paper leading-relaxed line-clamp-4">{ex.text}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted">
                <span>{ex.applied_by?.toUpperCase()}</span>
                {ex.confidence != null && <span>{Math.round(ex.confidence * 100)}% conf</span>}
                {ex.assignment && <span>{ex.assignment}</span>}
                {ex.co_labels.length > 0 && <span>+ {ex.co_labels.join(', ')}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
