import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { HistoryPage } from '../pages/HistoryPage'
import { api } from '../services/api'

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
    getCandidates: vi.fn().mockResolvedValue([]),
    discoverConcepts: vi.fn().mockResolvedValue({ run_id: '123', status: 'running' }),
    getEmbedStatus: vi.fn().mockResolvedValue({ cached: 0, total_unlabeled: 0, running: false }),
    archiveLabel: vi.fn().mockResolvedValue({ archived_at: '', messages_returned_to_queue: 0 }),
    getQueuePosition: vi.fn().mockResolvedValue({ position: 1, total_remaining: 50 }),
    getRecentHistory: vi.fn().mockResolvedValue([]),
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
  // Labels render lowercase in the DOM and are uppercased via CSS, so the
  // accessible name is lowercase — match case-insensitively.
  renderHistory()
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument()
  })
  expect(screen.getByRole('button', { name: /^human$/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^ai$/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^skipped$/i })).toBeInTheDocument()
})

test('shows confidence percentage for AI items', async () => {
  renderHistory()
  await waitFor(() => {
    expect(screen.getByText('72%')).toBeInTheDocument()
  })
})

test('shows search input', async () => {
  // Placeholder uses a typographic ellipsis (…); match by prefix.
  renderHistory()
  await waitFor(() => {
    expect(screen.getByPlaceholderText(/Search messages/)).toBeInTheDocument()
  })
})

test('renders a placeholder when a message has no cached text', async () => {
  // A labeled/skipped message whose text is missing from MessageCache comes
  // back as an empty string from the API; the row must not render blank.
  vi.mocked(api.getHistory).mockResolvedValueOnce({
    items: [
      { chatlog_id: 9, message_index: 0, message_text: '', context_before: null, context_after: null, labels: ['copy and paste'], status: 'labeled' as const, applied_by: 'human' as const, confidence: null, processed_at: '2026-03-28T10:15:00' },
    ],
    total: 1,
  })
  renderHistory()
  await waitFor(() => {
    expect(screen.getByText('No message text')).toBeInTheDocument()
  })
})
