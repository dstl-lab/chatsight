import { useMode } from '../hooks/useMode'
import { MultiLabelAnalysis } from './analysis/MultiLabelAnalysis'
import { SingleLabelAnalysis } from './analysis/SingleLabelAnalysis'

export function AnalysisPage() {
  const { mode } = useMode()
  return mode === 'single' ? <SingleLabelAnalysis /> : <MultiLabelAnalysis />
}
