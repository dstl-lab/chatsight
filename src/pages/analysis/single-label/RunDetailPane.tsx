import { useEffect, useState } from 'react'
import { api } from '../../../services/api'
import type { SingleLabelRunDetail } from '../../../types'
import { ConfidenceHistogram } from './ConfidenceHistogram'
import { CoverageCard } from './CoverageCard'
import { AgreementByConfidence } from './AgreementByConfidence'
import { DisagreementCallout } from './DisagreementCallout'
import { YesRateByAssignmentChart } from './YesRateByAssignmentChart'
import { YesRateByPositionChart } from './YesRateByPositionChart'
import { YesRateByHourOfDayChart } from './YesRateByHourOfDayChart'
import { YesRateByConversationDepthChart } from './YesRateByConversationDepthChart'
import { ExamplesDrawer } from './ExamplesDrawer'

type Subtab = 'health' | 'findings'

type Props = {
  runId: number | null
}

export function RunDetailPane({ runId }: Props) {
  const [detail, setDetail] = useState<SingleLabelRunDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [subtab, setSubtab] = useState<Subtab>('health')
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    if (runId == null) {
      setDetail(null)
      setError(null)
      return
    }
    let alive = true
    setError(null)
    setDetail(null)
    api
      .getSingleLabelRunDetail(runId)
      .then((d) => {
        if (alive) setDetail(d)
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [runId])

  // Close drawer on run change
  useEffect(() => {
    setDrawerOpen(false)
  }, [runId])

  if (runId == null) {
    return (
      <section className="flex-1 flex items-center justify-center text-muted italic text-[13px]">
        Pick a run to read.
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
        — loading run
      </section>
    )
  }

  const totals = {
    yes: detail.run.yes_pct === 0 ? 0 : Math.round((detail.run.yes_pct / 100) * detail.run.walked),
    no: detail.run.walked - Math.round((detail.run.yes_pct / 100) * detail.run.walked),
    edge: detail.disagreement.disagree,
  }

  return (
    <section className="flex-1 flex flex-col min-w-0 min-h-0">
      <header className="flex items-center justify-between px-6 py-3.5 border-b border-edge-warm">
        <div className="flex items-baseline gap-3.5 min-w-0">
          <span
            className="text-[10.5px] text-ochre tracking-[0.12em]"
            style={{ fontFeatureSettings: '"smcp", "tnum"' }}
          >
            RUN
          </span>
          <span className="font-serif font-medium text-[22px] text-paper tracking-[-0.012em] truncate">
            {detail.run.label_name}
          </span>
          <span className="text-[12px] text-muted italic ml-1 truncate">
            walked{' '}
            <span
              className="not-italic text-paper"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {detail.run.walked}/{detail.run.total_target ?? '?'}
            </span>
            <span className="text-ochre-dim mx-2">·</span>
            yes{' '}
            <span
              className="not-italic text-paper"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {detail.run.yes_pct}%
            </span>{' '}
            <span className="opacity-60">msgs</span> /{' '}
            <span
              className="not-italic text-paper"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {detail.run.conv_yes_pct}%
            </span>{' '}
            <span className="opacity-60">convos</span>
            <span className="text-ochre-dim mx-2">·</span>
            <span
              className="not-italic text-paper"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {detail.disagreement.disagree}
            </span>
            /
            <span
              className="not-italic text-paper"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {detail.disagreement.overlap_count}
            </span>{' '}
            overlap disagreed
          </span>
        </div>
      </header>

      <nav className="flex items-stretch px-6 border-b border-edge-warm" role="tablist">
        <SubtabBtn
          selected={subtab === 'health'}
          onClick={() => setSubtab('health')}
          label="Label health"
          count={2}
        />
        <SubtabBtn
          selected={subtab === 'findings'}
          onClick={() => setSubtab('findings')}
          label="Findings"
          count={4}
        />
      </nav>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {subtab === 'health' && <HealthSubtab detail={detail} />}
        {subtab === 'findings' && (
          <FindingsSubtab
            detail={detail}
            totals={totals}
            onOpenExamples={() => setDrawerOpen(true)}
          />
        )}
      </div>

      <ExamplesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        runLabel={detail.run.label_name}
        examples={detail.examples}
        totals={totals}
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

function HealthSubtab({ detail }: { detail: SingleLabelRunDetail }) {
  return (
    <div className="flex-1 min-h-0 px-6 py-4 grid gap-3.5 overflow-hidden" style={{ gridTemplateColumns: '1fr 252px', gridTemplateRows: '1fr auto' }}>
      <div style={{ gridColumn: 1, gridRow: 1 }} className="min-h-0 flex flex-col">
        <ConfidenceHistogram histogram={detail.confidence_histogram} />
      </div>
      <div style={{ gridColumn: 2, gridRow: 1 }} className="flex flex-col gap-3 min-h-0">
        <CoverageCard coverage={detail.ai_coverage} />
        <AgreementByConfidence buckets={detail.agreement_by_confidence.buckets} />
      </div>
      <div style={{ gridColumn: '1 / -1', gridRow: 2 }}>
        <DisagreementCallout disagreement={detail.disagreement} />
      </div>
    </div>
  )
}

function FindingsSubtab({
  detail,
  totals,
  onOpenExamples,
}: {
  detail: SingleLabelRunDetail
  totals: { yes: number; no: number; edge: number }
  onOpenExamples: () => void
}) {
  return (
    <div className="flex-1 min-h-0 px-6 py-4 grid gap-3.5 overflow-hidden" style={{ gridTemplateColumns: '1fr 1fr', gridTemplateRows: '1fr auto' }}>
      <div style={{ gridColumn: 1, gridRow: 1 }} className="chart-card min-h-0 flex flex-col">
        <div className="flex items-baseline justify-between mb-2.5">
          <div className="text-sm font-serif font-medium text-paper">
            Yes-rate by assignment
          </div>
          <span className="text-[11px] text-muted italic">sorted desc · n superscript</span>
        </div>
        <div className="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">
          <YesRateByAssignmentChart rows={detail.by_assignment} />
        </div>
      </div>
      <div style={{ gridColumn: 2, gridRow: 1 }} className="flex flex-col gap-3 min-h-0 overflow-y-auto">
        <div className="chart-card">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-sm font-serif font-medium text-paper">By conversation position</div>
            <span className="text-[11px] text-muted italic">depth within a chat</span>
          </div>
          <YesRateByPositionChart rows={detail.by_position} />
        </div>
        <div className="chart-card">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-sm font-serif font-medium text-paper">By hour of day</div>
            <span className="text-[11px] text-muted italic">when students ask</span>
          </div>
          <YesRateByHourOfDayChart rows={detail.by_hour_of_day} />
        </div>
        <div className="chart-card">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-sm font-serif font-medium text-paper">By conversation depth</div>
            <span className="text-[11px] text-muted italic">total chat length</span>
          </div>
          <YesRateByConversationDepthChart rows={detail.by_conversation_depth} />
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenExamples}
        style={{ gridColumn: '1 / -1', gridRow: 2 }}
        className="appearance-none bg-canvas border border-edge-warm rounded-sm px-4 py-2.5 flex items-center justify-between text-[12px] text-paper cursor-pointer hover:bg-elevated transition-colors"
      >
        <span className="inline-flex gap-3 items-baseline">
          <strong className="font-serif font-medium">Example messages</strong>
          <ExPill v={totals.yes} lbl="YES" />
          <ExPill v={totals.no} lbl="NO" />
          <ExPill v={totals.edge} lbl="EDGE" />
        </span>
        <span className="text-ochre">▸</span>
      </button>
    </div>
  )
}

function ExPill({ v, lbl }: { v: number; lbl: string }) {
  return (
    <span
      className="text-[10.5px] text-muted tracking-[0.08em]"
      style={{ fontFeatureSettings: '"smcp", "tnum"' }}
    >
      {lbl}{' '}
      <span
        className="text-paper font-medium ml-0.5"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {v}
      </span>
    </span>
  )
}
