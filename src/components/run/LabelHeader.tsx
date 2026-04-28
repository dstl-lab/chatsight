import type { LabelDashboardItem, ReadinessState } from '../../types'
import { ReadinessGauge } from './ReadinessGauge'

interface Props {
  label: LabelDashboardItem
  readiness: ReadinessState | null
  onHandoff: () => void
  handoffDisabled: boolean
  loading: boolean
}

export function LabelHeader({ label, readiness, onHandoff, handoffDisabled, loading }: Props) {
  return (
    <div className="border-b border-neutral-800 bg-neutral-900 px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{label.name}</h1>
          {label.description && (
            <p className="text-neutral-400 text-sm mt-0.5">{label.description}</p>
          )}
        </div>
        <button
          onClick={onHandoff}
          disabled={handoffDisabled || loading}
          className="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
        >
          {loading ? 'Running…' : 'Hand off to Gemini'}
        </button>
      </div>
      {readiness && (
        <div className="mt-3">
          <ReadinessGauge state={readiness} />
        </div>
      )}
    </div>
  )
}
