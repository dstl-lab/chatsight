import type { SingleLabelDetail, ConfidenceHistogramBin } from '../../types'

export type SummariesTab = 'browse' | 'settings'
export type MenuAction = 'rename' | 'edit' | 'rehandoff' | 'delete'

interface DetailHeaderProps {
  detail: SingleLabelDetail
  activeTab: SummariesTab
  onTabChange: (tab: SummariesTab) => void
  onMenuAction: (action: MenuAction) => void
}

export function DetailHeader({ detail, activeTab, onTabChange, onMenuAction }: DetailHeaderProps) {
  const hasInfo =
    detail.agreement_vs_gold !== null || (detail.confidence_histogram?.length ?? 0) > 0

  return (
    <div className="border-b border-edge px-7 pt-5">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-serif font-medium text-[26px] text-paper tracking-[-0.012em] truncate">{detail.name}</div>
          {detail.description && (
            <div className="font-serif italic text-[13px] text-muted mt-0.5 truncate">{detail.description}</div>
          )}
        </div>
        <details className="relative">
          <summary className="list-none cursor-pointer font-mono text-[10.5px] tracking-[0.12em] uppercase text-muted border border-edge rounded-sm px-2 py-1 hover:text-paper select-none">⋯</summary>
          <div className="absolute right-0 mt-1 bg-canvas border border-edge rounded-sm shadow-lg p-1 z-10 w-48 font-mono text-[11px] tracking-[0.08em] uppercase">
            <button onClick={() => onMenuAction('rename')} className="block w-full text-left px-3 py-1.5 hover:bg-surface">Rename</button>
            <button onClick={() => onMenuAction('edit')} className="block w-full text-left px-3 py-1.5 hover:bg-surface">Edit description</button>
            <button onClick={() => onMenuAction('rehandoff')} className="block w-full text-left px-3 py-1.5 hover:bg-surface">Re-handoff</button>
            <button onClick={() => onMenuAction('delete')} className="block w-full text-left px-3 py-1.5 hover:bg-surface text-brick">Delete</button>
          </div>
        </details>
      </div>

      <div className="flex items-center gap-6 py-3.5 font-mono text-[11px]">
        <span><span className="text-moss text-[14px]">{detail.yes_count}</span><span className="text-faint text-[9px] tracking-[0.16em] uppercase ml-1.5">YES</span></span>
        <span><span className="text-brick text-[14px]">{detail.no_count}</span><span className="text-faint text-[9px] tracking-[0.16em] uppercase ml-1.5">NO</span></span>
        <span><span className="text-ochre text-[14px]">{detail.review_count}</span><span className="text-faint text-[9px] tracking-[0.16em] uppercase ml-1.5">REVIEW</span></span>
        {hasInfo && (
          <span tabIndex={0} className="relative group text-faint cursor-help focus:outline-none focus:text-on-canvas hover:text-on-canvas">
            ⓘ
            <InfoPanel detail={detail} />
          </span>
        )}
      </div>

      <div className="flex gap-0 -mb-px">
        {(['browse', 'settings'] as SummariesTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`py-3 mr-6 font-mono text-[11px] tracking-[0.14em] uppercase border-b-2 ${
              activeTab === tab ? 'text-paper border-ochre' : 'text-muted border-transparent hover:text-on-canvas'
            }`}
          >
            {tab === 'browse' ? 'Triage' : 'Settings'}
          </button>
        ))}
      </div>
    </div>
  )
}

function InfoPanel({ detail }: { detail: SingleLabelDetail }) {
  const bins = detail.confidence_histogram ?? []
  const maxCount = bins.reduce((m, b) => Math.max(m, b.count), 0)
  const agreementPct =
    detail.agreement_vs_gold !== null ? Math.round(detail.agreement_vs_gold * 100) : null

  return (
    <div
      role="tooltip"
      className="invisible opacity-0 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100 transition-opacity duration-100 absolute top-full right-0 mt-2 z-20 w-72 bg-canvas border border-edge rounded-sm shadow-lg p-3 cursor-default"
    >
      <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-faint mb-1.5">
        Confidence distribution
      </div>
      {bins.length > 0 ? (
        <Sparkline bins={bins} maxCount={maxCount} />
      ) : (
        <div className="font-serif italic text-[12px] text-muted">No AI predictions yet.</div>
      )}

      <div className="mt-3 pt-2.5 border-t border-edge-subtle flex items-baseline justify-between">
        <span className="font-mono text-[9px] tracking-[0.18em] uppercase text-faint">
          Agreement vs gold
        </span>
        <span className="font-mono text-[13px] text-paper tabular-nums">
          {agreementPct !== null ? `${agreementPct}%` : '—'}
        </span>
      </div>
    </div>
  )
}

function Sparkline({ bins, maxCount }: { bins: ConfidenceHistogramBin[]; maxCount: number }) {
  const height = 36
  const gap = 2
  const width = 248
  const barWidth = (width - gap * (bins.length - 1)) / bins.length

  return (
    <>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label="Confidence distribution sparkline"
        className="block"
      >
        {bins.map((bin, i) => {
          const h = maxCount > 0 ? (bin.count / maxCount) * height : 0
          const x = i * (barWidth + gap)
          const y = height - h
          return (
            <rect
              key={i}
              x={x}
              y={y}
              width={barWidth}
              height={h}
              className="fill-ochre-dim"
            >
              <title>{`${bin.range_lo.toFixed(2)}–${bin.range_hi.toFixed(2)}: ${bin.count}`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="mt-1 flex justify-between font-mono text-[9px] tracking-[0.08em] text-faint tabular-nums">
        <span>{bins[0]?.range_lo.toFixed(2) ?? '0.00'}</span>
        <span>{bins[bins.length - 1]?.range_hi.toFixed(2) ?? '1.00'}</span>
      </div>
    </>
  )
}
