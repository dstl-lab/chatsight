import type { HandoffSummaryItem } from '../../types'

interface LabelRailProps {
  items: HandoffSummaryItem[]
  activeId: number | null
  onSelect: (id: number) => void
}

type Kind = 'done' | 'classifying' | 'failed' | 'archived'

function statusKind(item: HandoffSummaryItem): Kind {
  if (item.phase === 'classifying') return 'classifying'
  if (item.phase === 'failed') return 'failed'
  if (item.phase === 'archived') return 'archived'
  return 'done'
}

function subtitle(item: HandoffSummaryItem): string {
  if (item.phase === 'classifying') {
    const pct =
      item.classification_total && item.classification_total > 0
        ? Math.round(((item.classified_count ?? 0) / item.classification_total) * 100)
        : null
    return pct !== null ? `${pct}% · running` : 'running'
  }
  if (item.phase === 'failed') {
    return item.error_kind === 'rate_limited' ? '⏱ rate-limited' : '✕ failed'
  }
  const total = item.yes_count + item.no_count + item.review_count
  return `${total} · ${item.review_count} in review`
}

export function LabelRail({ items, activeId, onSelect }: LabelRailProps) {
  return (
    <aside className="w-[220px] shrink-0 border-r border-edge bg-canvas overflow-y-auto p-3">
      <div className="font-mono text-[9.5px] tracking-[0.18em] uppercase text-faint mb-2 px-1.5">
        Labels · {items.length}
      </div>
      {items.map((item) => {
        const isActive = item.label_id === activeId
        const kind = statusKind(item)
        return (
          <button
            key={item.label_id}
            data-testid={`rail-row-${item.label_id}`}
            data-active={String(isActive)}
            onClick={() => onSelect(item.label_id)}
            className={`w-full text-left p-2.5 rounded-md mb-0.5 transition-colors ${
              isActive ? 'bg-elevated' : 'hover:bg-surface'
            }`}
          >
            <div className="text-paper text-[13px] flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full inline-block ${
                  kind === 'classifying' ? 'bg-ochre animate-pulse'
                  : kind === 'failed' ? 'bg-brick'
                  : kind === 'archived' ? 'bg-stone'
                  : 'bg-moss'
                }`}
              />
              {item.label_name}
            </div>
            <div className="font-mono text-[10px] text-muted mt-0.5">{subtitle(item)}</div>
          </button>
        )
      })}
    </aside>
  )
}
