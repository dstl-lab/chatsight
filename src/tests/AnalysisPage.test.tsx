import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnalysisPage } from '../pages/AnalysisPage'
import { ModeProvider } from '../hooks/useMode'
import { api } from '../services/api'

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
    deleteLabel: vi.fn().mockResolvedValue({ ok: true, deleted_applications: 0 }),
    getQueueStats: vi.fn().mockResolvedValue({ total_messages: 100, labeled_count: 50, skipped_count: 10 }),
    getQueuePosition: vi.fn().mockResolvedValue({ position: 1, total_remaining: 50 }),
    getRecentHistory: vi.fn().mockResolvedValue([]),
    getLabels: vi.fn().mockResolvedValue([]),
    getSingleLabelCohort: vi.fn().mockResolvedValue({ runs: [] }),
    getSingleLabelRunDetail: vi.fn().mockResolvedValue(null),
    getMultiLabelCohort: vi.fn().mockResolvedValue({
      labels: [
        {
          label_id: 1,
          label_name: 'Concept Question',
          description: null,
          human_count: 5,
          ai_count: 2,
          total_count: 6,
          high_conf_pct: 100,
          low_conf_count: 0,
          human_pct: 83,
          updated_at: '2026-03-28T10:00:00Z',
          weekly_sparkline: [20, 40],
        },
      ],
    }),
    getMultiLabelDetail: vi.fn().mockResolvedValue({
      label: {
        id: 1,
        label_name: 'Concept Question',
        description: null,
        updated_at: '2026-03-28T10:00:00Z',
        human_count: 5,
        ai_count: 2,
        total_count: 6,
        human_pct: 83,
      },
      confidence_histogram: { bins: Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, count: i === 9 ? 2 : 0 })), coverage: { with_confidence: 2, total_ai: 2 } },
      provenance: { human_applications: 5, ai_applications: 2, human_pct: 71 },
      position_distribution: [
        { bucket: 'early', count: 2, pct: 33 },
        { bucket: 'mid', count: 2, pct: 33 },
        { bucket: 'late', count: 2, pct: 33 },
      ],
      by_assignment: [{ key: 'Lab 1', human: 3, ai: 1, total: 4, human_pct: 75 }],
      co_occurring_labels: [],
      by_hour_of_day: Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 })),
      examples: { human: [], low_confidence: [] },
      paired_single_label: null,
    }),
    getMilestones: vi.fn().mockResolvedValue([]),
  },
}))

function renderPage(mode: 'single' | 'multi' = 'multi') {
  localStorage.clear()
  localStorage.setItem('chatsight-mode', mode)
  return render(
    <MemoryRouter>
      <ModeProvider>
        <AnalysisPage />
      </ModeProvider>
    </MemoryRouter>,
  )
}

test('renders SingleLabelAnalysis when mode === "single"', async () => {
  renderPage('single')
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: /Single-label runs/i })).toBeInTheDocument(),
  )
})

test('renders MultiLabelAnalysis when mode === "multi"', async () => {
  renderPage('multi')
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: /Multi-label taxonomy/i })).toBeInTheDocument(),
  )
  await waitFor(() =>
    expect(screen.getByText('Concept Question')).toBeInTheDocument(),
  )
})

test('shows multi-label detail when a label is selected', async () => {
  renderPage('multi')
  await waitFor(() => screen.getByText('Concept Question'))
  await waitFor(() => {
    expect(screen.getByText('LABEL')).toBeInTheDocument()
  })
  expect(vi.mocked(api.getMultiLabelDetail)).toHaveBeenCalledWith(1)
})
