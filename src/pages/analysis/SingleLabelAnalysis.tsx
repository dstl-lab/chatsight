import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CohortRail } from './single-label/CohortRail'
import { RunDetailPane } from './single-label/RunDetailPane'
import type { SingleLabelCohortRow } from '../../types'

export function SingleLabelAnalysis() {
  const [params, setParams] = useSearchParams()
  const [progressDone, setProgressDone] = useState(false)

  const urlRunId = Number(params.get('run_id') ?? '0') || null

  const setRunId = (next: number) => {
    const update = new URLSearchParams(params)
    update.set('run_id', String(next))
    setParams(update, { replace: false })
  }

  const handleCohortLoaded = (rows: SingleLabelCohortRow[]) => {
    setProgressDone(true)
    if (urlRunId == null && rows.length > 0) {
      // Default-select the most-recently-updated run
      const mostRecent = [...rows].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      )[0]
      const update = new URLSearchParams(params)
      update.set('run_id', String(mostRecent.run_id))
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
      <CohortRail
        selectedRunId={urlRunId}
        onSelectRun={setRunId}
        onLoaded={handleCohortLoaded}
      />
      <RunDetailPane runId={urlRunId} />
    </div>
  )
}
