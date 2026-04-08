import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { HistoryPage } from '../pages/HistoryPage'

const { mockHistory } = vi.hoisted(() => ({
  mockHistory: [
    { chatlog_id: 1, message_index: 0, message_text: 'What is a DataFrame?', context_before: null, context_after: null, labels: ['Concept Q'], status: 'labeled' as const, applied_by: 'human' as const, confidence: null, processed_at: '2026-03-28T10:05:00' },
    { chatlog_id: 2, message_index: 0, message_text: 'How do I filter rows?', context_before: null, context_after: null, labels: ['Debug Help'], status: 'labeled' as const, applied_by: 'ai' as const, confidence: 0.72, processed_at: '2026-03-28T10:10:00' },
    { chatlog_id: 3, message_index: 0, message_text: 'Thanks!', context_before: null, context_after: null, labels: [], status: 'skipped' as const, applied_by: null, confidence: null, processed_at: '2026-03-28T10:12:00' },
  ],
}))

vi.mock('../services/api', () => ({
  api: {
    getHistory: vi.fn().mockResolvedValue({ items: mockHistory, total: 3 }),
    getQueueStats: vi.fn().mockResolvedValue({ total_messages: 100, labeled_count: 50, skipped_count: 10 }),
  },
}))

const renderHistory = () => render(<MemoryRouter><HistoryPage /></MemoryRouter>)

test('renders stat cards after loading', async () => {
  renderHistory()
  await waitFor(() => {
    expect(screen.getByText('100')).toBeInTheDocument()
  })
  expect(screen.getByText('50')).toBeInTheDocument()
  expect(screen.getByText('10')).toBeInTheDocument()
})

test('renders history rows', async () => {
  renderHistory()
  await waitFor(() => {
    expect(screen.getByText('What is a DataFrame?')).toBeInTheDocument()
  })
  expect(screen.getByText('How do I filter rows?')).toBeInTheDocument()
  expect(screen.getByText('Thanks!')).toBeInTheDocument()
})

test('shows filter tabs', async () => {
  renderHistory()
  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument()
  })
  expect(screen.getByRole('button', { name: 'Human' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Ai' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Skipped' })).toBeInTheDocument()
})

test('shows confidence percentage for AI items', async () => {
  renderHistory()
  await waitFor(() => {
    expect(screen.getByText('72%')).toBeInTheDocument()
  })
})

test('shows search input', async () => {
  renderHistory()
  await waitFor(() => {
    expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument()
  })
})
