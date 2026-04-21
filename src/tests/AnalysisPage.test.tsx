import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnalysisPage } from '../pages/AnalysisPage'
import { api } from '../services/api'
import { mockApi } from '../mocks'

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
    getAnalysisSummary: vi.fn(),
    getTemporalAnalysis: vi.fn(),
    exportCsv: vi.fn(),
    getCandidates: vi.fn().mockResolvedValue([]),
    discoverConcepts: vi.fn().mockResolvedValue({ run_id: '123', status: 'running' }),
    getEmbedStatus: vi.fn().mockResolvedValue({ cached: 0, total_unlabeled: 0, running: false }),
    archiveLabel: vi.fn().mockResolvedValue({ archived_at: '', messages_returned_to_queue: 0 }),
    getQueueStats: vi.fn().mockResolvedValue({ total_messages: 100, labeled_count: 50, skipped_count: 10 }),
    getQueuePosition: vi.fn().mockResolvedValue({ position: 1, total_remaining: 50 }),
    getRecentHistory: vi.fn().mockResolvedValue([]),
    getLabels: vi.fn().mockResolvedValue([]),
  },
}))

const mockedApi = api as {
  getAnalysisSummary: ReturnType<typeof vi.fn>
  getTemporalAnalysis: ReturnType<typeof vi.fn>
  exportCsv: ReturnType<typeof vi.fn>
}

function renderPage() {
  return render(<MemoryRouter><AnalysisPage /></MemoryRouter>)
}

beforeEach(() => {
  mockedApi.getAnalysisSummary.mockResolvedValue(mockApi.analysisSummary)
  mockedApi.getTemporalAnalysis.mockResolvedValue(mockApi.temporalAnalysis)
  mockedApi.exportCsv.mockResolvedValue(new Blob(['test'], { type: 'text/csv' }))
})

test('shows loading state initially', () => {
  mockedApi.getAnalysisSummary.mockReturnValue(new Promise(() => {}))
  mockedApi.getTemporalAnalysis.mockReturnValue(new Promise(() => {}))
  renderPage()
  expect(screen.getByText('Loading analysis…')).toBeInTheDocument()
})

test('renders main chart headings after data loads', async () => {
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('Label Frequency')).toBeInTheDocument()
  })
  expect(screen.getByText('Coverage')).toBeInTheDocument()
  expect(screen.getByText('Conversation Position')).toBeInTheDocument()
})

test('renders temporal section headings after data loads', async () => {
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('Temporal & usage context')).toBeInTheDocument()
  })
  expect(screen.getByText('Tutor usage (hour of day)')).toBeInTheDocument()
  expect(screen.getByText('Tutor usage (day of week)')).toBeInTheDocument()
  expect(screen.getByText('Notebook × label heatmap')).toBeInTheDocument()
  expect(screen.getByText('Labeling throughput')).toBeInTheDocument()
})

test('renders the CSV export button', async () => {
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('Download CSV')).toBeInTheDocument()
  })
})

test('shows error state on API failure', async () => {
  mockedApi.getAnalysisSummary.mockRejectedValue(new Error('Network error'))
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })
})

test('shows summary when temporal fails but summary succeeds', async () => {
  mockedApi.getTemporalAnalysis.mockRejectedValue(new Error('Temporal unavailable'))
  renderPage()
  await waitFor(() => {
    expect(screen.getByText('Label Frequency')).toBeInTheDocument()
  })
  await waitFor(() => {
    expect(screen.getByText(/Temporal charts unavailable/)).toBeInTheDocument()
  })
})
