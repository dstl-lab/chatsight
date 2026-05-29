import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { SummariesPageMulti } from '../pages/summaries/SummariesPageMulti'
import type { MultiLabelAutolabelSummaryItem } from '../types'

const { mockGetSummary, mockGetAutolabelStatus } = vi.hoisted(() => ({
  mockGetSummary: vi.fn(),
  mockGetAutolabelStatus: vi.fn(),
}))

vi.mock('../services/api', () => ({
  api: {
    getMultiLabelAutolabelSummary: mockGetSummary,
    getAutolabelStatus: mockGetAutolabelStatus,
  },
}))

beforeEach(() => {
  mockGetSummary.mockReset()
  mockGetAutolabelStatus.mockReset()
  // Default: no autolabel run in flight.
  mockGetAutolabelStatus.mockResolvedValue({ running: false, processed: 0, total: 0, error: null })
})

const withAi: MultiLabelAutolabelSummaryItem = {
  label_id: 1,
  label_name: 'Direct Answer Request',
  description: 'Student asks for the answer outright',
  human_count: 12,
  ai_count: 10,
  high_conf_count: 8,
  low_conf_count: 2,
}

const noAi: MultiLabelAutolabelSummaryItem = {
  label_id: 2,
  label_name: 'Conceptual Question',
  description: null,
  human_count: 5,
  ai_count: 0,
  high_conf_count: 0,
  low_conf_count: 0,
}

test('shows empty state when there are no labels', async () => {
  mockGetSummary.mockResolvedValue([])
  render(<SummariesPageMulti />)
  await waitFor(() => {
    expect(screen.getByText('No labels yet')).toBeInTheDocument()
  })
})

test('renders a label card with human and AI counts', async () => {
  mockGetSummary.mockResolvedValue([withAi])
  render(<SummariesPageMulti />)
  await waitFor(() => {
    expect(screen.getByText('Direct Answer Request')).toBeInTheDocument()
  })
  expect(screen.getByText('Student asks for the answer outright')).toBeInTheDocument()
  // Human count (12) and AI count (10) are surfaced.
  expect(screen.getByText('12')).toBeInTheDocument()
  expect(screen.getByText('10')).toBeInTheDocument()
})

test('renders the AI confidence percentage (high_conf / ai)', async () => {
  mockGetSummary.mockResolvedValue([withAi])
  render(<SummariesPageMulti />)
  // 8 high-conf of 10 AI = 80%
  await waitFor(() => {
    expect(screen.getByText('80%')).toBeInTheDocument()
  })
  expect(screen.getByText('8 high-conf')).toBeInTheDocument()
  expect(screen.getByText('2 below threshold')).toBeInTheDocument()
})

test('shows the no-AI hint when a label has only human labels', async () => {
  mockGetSummary.mockResolvedValue([noAi])
  render(<SummariesPageMulti />)
  await waitFor(() => {
    expect(screen.getByText('Conceptual Question')).toBeInTheDocument()
  })
  expect(
    screen.getByText(/No AI labels yet/i),
  ).toBeInTheDocument()
})

test('shows the auto-labeling in-progress banner while a run is active', async () => {
  mockGetSummary.mockResolvedValue([withAi])
  mockGetAutolabelStatus.mockResolvedValue({ running: true, processed: 5, total: 20, error: null })
  render(<SummariesPageMulti />)
  await waitFor(() => {
    expect(screen.getByText('Auto-labeling in progress')).toBeInTheDocument()
  })
  expect(screen.getByText('5 of 20 messages classified')).toBeInTheDocument()
})
