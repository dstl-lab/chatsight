// src/tests/QueuePage.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { QueuePage } from '../pages/QueuePage'
import * as apiModule from '../services/api'
import { mockApi } from '../mocks'

vi.mock('../services/api', () => ({
  api: {
    startSession: vi.fn().mockResolvedValue({
      id: 1,
      started_at: '2026-03-28T10:00:00',
      last_active: '2026-03-28T10:30:00',
      labeled_count: 14,
    }),
    getLabels: vi.fn().mockResolvedValue([
      { id: 1, name: 'Concept Question', description: 'Student asks for an explanation of a new concept', created_at: '2026-03-28T00:00:00', count: 5 },
      { id: 2, name: 'Clarification', description: null, created_at: '2026-03-28T00:00:00', count: 3 },
      { id: 3, name: 'Debug Help', description: 'Student needs help fixing an error', created_at: '2026-03-28T00:00:00', count: 2 },
    ]),
    getQueue: vi.fn().mockResolvedValue([
      {
        chatlog_id: 1,
        message_index: 0,
        message_text: "Can you explain what a DataFrame is and how it's different from a regular Python list?",
        context_before: 'You can think of it like a spreadsheet with rows and columns...',
        context_after: 'Great question! The key difference is that DataFrames are optimized for...',
      },
      {
        chatlog_id: 1,
        message_index: 2,
        message_text: 'How do I filter rows where the grade column is above 90?',
        context_before: 'You can use boolean indexing to filter DataFrames...',
        context_after: "Exactly. You can also use df.query('grade > 90') for the same result.",
      },
    ]),
    applyLabel: vi.fn().mockResolvedValue(undefined),
    skipMessage: vi.fn().mockResolvedValue(undefined),
    createLabel: vi.fn().mockResolvedValue({ id: 99, name: 'New', description: null, created_at: '', count: 0 }),
    getQueueStats: vi.fn().mockResolvedValue({ total_messages: 100, labeled_count: 14, skipped_count: 0 }),
  },
}))

const renderQueue = () =>
  render(<MemoryRouter><QueuePage /></MemoryRouter>)

test('shows first message after loading', async () => {
  renderQueue()
  await waitFor(() => {
    expect(screen.getByText(mockApi.queue[0].message_text)).toBeInTheDocument()
  })
})

test('shows label chips', async () => {
  renderQueue()
  await waitFor(() => {
    expect(screen.getAllByText('Concept Question').length).toBeGreaterThan(0)
  })
})

test('advances to next message when label chip clicked', async () => {
  renderQueue()
  await waitFor(() => screen.getByText(mockApi.queue[0].message_text))
  // click the button chip in the LabelStrip (not the span in ProgressSidebar)
  const chips = screen.getAllByRole('button', { name: 'Concept Question' })
  fireEvent.click(chips[0])
  await waitFor(() => {
    expect(screen.getByText(mockApi.queue[1].message_text)).toBeInTheDocument()
  })
})

test('skips current message when skip clicked', async () => {
  renderQueue()
  await waitFor(() => screen.getByText(mockApi.queue[0].message_text))
  fireEvent.click(screen.getByText(/skip/i))
  expect(apiModule.api.skipMessage).toHaveBeenCalled()
})
