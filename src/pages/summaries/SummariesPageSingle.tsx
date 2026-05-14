import { useEffect, useState, useCallback } from 'react'
import { LabelRail } from '../../components/summaries/LabelRail'
import { DetailHeader, type SummariesTab } from '../../components/summaries/DetailHeader'
import { BrowseTab } from '../../components/summaries/BrowseTab'
import { api } from '../../services/api'
import type { HandoffSummaryItem, SingleLabelDetail } from '../../types'

export function SummariesPageSingle() {
  const [items, setItems] = useState<HandoffSummaryItem[]>([])
  const [activeId, setActiveId] = useState<number | null>(() => {
    const stored = localStorage.getItem('summaries.active_label_id')
    return stored ? Number(stored) : null
  })
  const [detail, setDetail] = useState<SingleLabelDetail | null>(null)
  const [tab, setTab] = useState<SummariesTab>('browse')

  const refreshList = useCallback(() => {
    api.listHandoffSummaries().then(setItems)
  }, [])

  const refreshDetail = useCallback(() => {
    if (activeId === null) {
      setDetail(null)
      return
    }
    api.getSingleLabelDetail(activeId).then(setDetail)
  }, [activeId])

  useEffect(() => { refreshList() }, [refreshList])
  useEffect(() => { refreshDetail() }, [refreshDetail])
  useEffect(() => {
    if (activeId !== null) localStorage.setItem('summaries.active_label_id', String(activeId))
  }, [activeId])

  if (items.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-on-surface">
        <div className="text-center max-w-md">
          <div className="font-mono text-[10px] tracking-[0.18em] uppercase text-faint mb-2">no labels yet</div>
          <div className="font-serif text-[15px]">
            Head to <a href="/run" className="text-ochre underline">Run</a> to create your first label.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex bg-canvas min-h-0">
      <LabelRail items={items} activeId={activeId} onSelect={(id) => { setActiveId(id); setTab('browse') }} />
      <section className="flex-1 flex flex-col min-w-0">
        {detail ? (
          <>
            <DetailHeader
              detail={detail}
              activeTab={tab}
              onTabChange={setTab}
              onMenuAction={() => { /* Task 24 */ }}
            />
            {tab === 'browse' && (
              <BrowseTab label={detail} onLabelChanged={() => { refreshList(); refreshDetail() }} />
            )}
            {tab === 'settings' && (
              <div className="flex-1 flex items-center justify-center text-muted">Settings tab — Task 24</div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted font-mono text-[11px] tracking-[0.16em] uppercase">
            select a label →
          </div>
        )}
      </section>
    </div>
  )
}
