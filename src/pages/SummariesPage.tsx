import { useMode } from '../hooks/useMode'
import { SummariesPageMulti } from './summaries/SummariesPageMulti'
import { SummariesPageSingle } from './summaries/SummariesPageSingle'

export function SummariesPage() {
  const { mode } = useMode()
  return mode === 'single' ? <SummariesPageSingle /> : <SummariesPageMulti />
}
