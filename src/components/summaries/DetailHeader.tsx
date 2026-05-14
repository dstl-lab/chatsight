import type { SingleLabelDetail } from '../../types'

export type SummariesTab = 'browse' | 'settings'
export type MenuAction = 'rename' | 'edit' | 'rehandoff' | 'delete'

interface DetailHeaderProps {
  detail: SingleLabelDetail
  activeTab: SummariesTab
  onTabChange: (tab: SummariesTab) => void
  onMenuAction: (action: MenuAction) => void
}

export function DetailHeader({ detail, activeTab, onTabChange, onMenuAction }: DetailHeaderProps) {
  const agreementTitle =
    detail.agreement_vs_gold !== null
      ? `Confidence distribution · agreement vs gold set: ${Math.round(detail.agreement_vs_gold * 100)}%`
      : undefined

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
        {agreementTitle && (
          <span title={agreementTitle} className="text-faint cursor-help">ⓘ</span>
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
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>
    </div>
  )
}
