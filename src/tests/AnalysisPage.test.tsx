import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnalysisPage } from '../pages/AnalysisPage'
import { ModeProvider } from '../hooks/useMode'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts')
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 500, height: 300 }}>{children}</div>
    ),
  }
})

vi.mock('../services/api', () => ({
  api: {
    getCandidates: vi.fn().mockResolvedValue([]),
    discoverConcepts: vi.fn().mockResolvedValue({ run_id: '123', status: 'running' }),
    getEmbedStatus: vi.fn().mockResolvedValue({ cached: 0, total_unlabeled: 0, running: false }),
    archiveLabel: vi.fn().mockResolvedValue({ archived_at: '', messages_returned_to_queue: 0 }),
    getQueueStats: vi.fn().mockResolvedValue({ total_messages: 100, labeled_count: 50, skipped_count: 10 }),
    getQueuePosition: vi.fn().mockResolvedValue({ position: 1, total_remaining: 50 }),
    getRecentHistory: vi.fn().mockResolvedValue([]),
    getLabels: vi.fn().mockResolvedValue([]),
    getSingleLabelCohort: vi.fn().mockResolvedValue({ runs: [] }),
    getSingleLabelRunDetail: vi.fn().mockResolvedValue(null),
    getMilestones: vi.fn().mockResolvedValue([]),
  },
}))

function renderPage() {
  localStorage.clear()
  localStorage.setItem('chatsight-mode', 'single')
  return render(
    <MemoryRouter>
      <ModeProvider>
        <AnalysisPage />
      </ModeProvider>
    </MemoryRouter>,
  )
}

test('renders SingleLabelAnalysis', async () => {
  renderPage()
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: /Single-label runs/i })).toBeInTheDocument(),
  )
})
