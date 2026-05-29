import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { LabelRail } from './multi-label/LabelRail'
import { LabelDetailPane } from './multi-label/LabelDetailPane'
import type { MultiLabelCohortRow } from '../../types'

export function MultiLabelAnalysis() {
  const [params, setParams] = useSearchParams()
  const [progressDone, setProgressDone] = useState(false)

  const urlLabelId = Number(params.get('label_id') ?? '0') || null

  const setLabelId = (next: number) => {
    const update = new URLSearchParams(params)
    update.set('label_id', String(next))
    setParams(update, { replace: false })
  }

  const handleLoaded = (rows: MultiLabelCohortRow[]) => {
    setProgressDone(true)
    if (urlLabelId == null && rows.length > 0) {
      const mostRecent = [...rows].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )[0]
      const update = new URLSearchParams(params)
      update.set('label_id', String(mostRecent.label_id))
      setParams(update, { replace: true })
    }
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden">
      {!progressDone && (
        <div
          aria-hidden="true"
          className="fixed top-0 left-0 right-0 h-0.5 bg-ochre origin-left z-[60]"
          style={{ animation: 'analysisProgress 900ms cubic-bezier(0.2,0.8,0.2,1) forwards' }}
        />
      )}
      <LabelRail
        selectedLabelId={urlLabelId}
        onSelectLabel={setLabelId}
        onLoaded={handleLoaded}
      />
      <LabelDetailPane labelId={urlLabelId} />
    </div>
  )
}
