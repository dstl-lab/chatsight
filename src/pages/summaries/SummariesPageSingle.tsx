import { useEffect, useState } from 'react'
import { LabelRail } from '../../components/summaries/LabelRail'
import { api } from '../../services/api'
import type { HandoffSummaryItem } from '../../types'

export function SummariesPageSingle() {
  const [items, setItems] = useState<HandoffSummaryItem[]>([])
  const [activeId, setActiveId] = useState<number | null>(() => {
    const stored = localStorage.getItem('summaries.active_label_id')
    return stored ? Number(stored) : null
  })

  useEffect(() => {
    api.listHandoffSummaries().then(setItems)
  }, [])

  useEffect(() => {
    if (activeId !== null) localStorage.setItem('summaries.active_label_id', String(activeId))
  }, [activeId])

  return (
    <div className="flex-1 flex bg-canvas min-h-0">
      <LabelRail items={items} activeId={activeId} onSelect={setActiveId} />
      <div className="flex-1 flex flex-col min-w-0 items-center justify-center text-muted">
        {activeId ? `selected label ${activeId} — Task 16 will render the header` : 'select a label →'}
      </div>
    </div>
  )
}
