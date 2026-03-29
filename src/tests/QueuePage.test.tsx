import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { QueuePage } from '../pages/QueuePage'
import * as apiModule from '../services/api'
import { mockApi } from '../mocks'

vi.mock('../services/api', () => ({
  api: {
    startSession: vi.fn().mockResolvedValue({
      id: 1, started_at: '2026-03-28T10:00:00',
      last_active: '2026-03-28T10:30:00', labeled_count: 14,
    }),
    getLabels: vi.fn().mockResolvedValue([
      { id: 1, name: 'Concept Question', description: 'Asks about a concept', created_at: '2026-03-28T00:00:00', count: 5 },
      { id: 2, name: 'Clarification', description: null, created_at: '2026-03-28T00:00:00', count: 3 },
    ]),
    getQueue: vi.fn().mockResolvedValue([
      {
        chatlog_id: 1, message_index: 0,
        message_text: "Can you explain what a DataFrame is?",
        context_before: 'Spreadsheet with rows...', context_after: 'Great question!',
      },
      {
        chatlog_id: 1, message_index: 2,
        message_text: 'How do I filter rows?',
        context_before: 'Boolean indexing...', context_after: 'Use df.query().',
      },
    ]),
    getQueueStats: vi.fn().mockResolvedValue({ total_messages: 100, labeled_count: 14, skipped_count: 0 }),
    getAppliedLabels: vi.fn().mockResolvedValue([]),
    applyLabel: vi.fn().mockResolvedValue(undefined),
    unapplyLabel: vi.fn().mockResolvedValue(undefined),
    skipMessage: vi.fn().mockResolvedValue(undefined),
    advanceMessage: vi.fn().mockResolvedValue({ ok: true, counted: true }),
    undoLabels: vi.fn().mockResolvedValue({ ok: true, removed_count: 1 }),
    createLabel: vi.fn().mockResolvedValue({ id: 99, name: 'New', description: null, created_at: '', count: 0 }),
    updateLabel: vi.fn().mockResolvedValue({ id: 1, name: 'Concept Question', description: 'Updated', created_at: '', count: 5 }),
  },
}))

const renderQueue = () => render(<MemoryRouter><QueuePage /></MemoryRouter>)

test('shows first message after loading', async () => {
  renderQueue()
  await waitFor(() => {
    expect(screen.getByText("Can you explain what a DataFrame is?")).toBeInTheDocument()
  })
})

test('shows label buttons in sidebar', async () => {
  renderQueue()
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /Concept Question/ })).toBeInTheDocument()
  })
})

test('toggling a label calls applyLabel', async () => {
  renderQueue()
  await waitFor(() => screen.getByText("Can you explain what a DataFrame is?"))
  fireEvent.click(screen.getByRole('button', { name: /Concept Question/ }))
  expect(apiModule.api.applyLabel).toHaveBeenCalled()
})

test('Next button advances after labeling', async () => {
  renderQueue()
  await waitFor(() => screen.getByText("Can you explain what a DataFrame is?"))
  // Apply a label
  fireEvent.click(screen.getByRole('button', { name: /Concept Question/ }))
  await waitFor(() => {
    // Next should now be enabled — click it
    const nextBtn = screen.getByText(/next/i)
    expect(nextBtn).not.toBeDisabled()
    fireEvent.click(nextBtn)
  })
  await waitFor(() => {
    expect(screen.getByText("How do I filter rows?")).toBeInTheDocument()
  })
})

test('skips message when skip clicked', async () => {
  renderQueue()
  await waitFor(() => screen.getByText("Can you explain what a DataFrame is?"))
  fireEvent.click(screen.getByText(/^skip$/i))
  expect(apiModule.api.skipMessage).toHaveBeenCalled()
})
