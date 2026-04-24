import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { QueuePage } from '../pages/QueuePage'

const {
  mockApplyLabel, mockSkipMessage, mockGetLabels,
} = vi.hoisted(() => ({
  mockApplyLabel: vi.fn().mockResolvedValue(undefined),
  mockSkipMessage: vi.fn().mockResolvedValue(undefined),
  mockGetLabels: vi.fn().mockResolvedValue([
    { id: 1, name: 'Concept Question', description: null, created_at: '', count: 0 },
    { id: 2, name: 'Debug Help', description: null, created_at: '', count: 0 },
  ]),
}))

vi.mock('../services/api', () => ({
  api: {
    startSession: vi.fn().mockResolvedValue({ id: 1, started_at: '', last_active: '', labeled_count: 0 }),
    getLabels: mockGetLabels,
    getQueue: vi.fn().mockResolvedValue([
      { chatlog_id: 1, message_index: 0, message_text: 'Test message', context_before: null, context_after: null },
    ]),
    getQueueStats: vi.fn().mockResolvedValue({ total_messages: 100, labeled_count: 0, skipped_count: 0 }),
    getAppliedLabels: vi.fn().mockResolvedValue([]),
    applyLabel: mockApplyLabel,
    unapplyLabel: vi.fn().mockResolvedValue(undefined),
    skipMessage: mockSkipMessage,
    advanceMessage: vi.fn().mockResolvedValue({ ok: true, counted: true }),
    undoLabels: vi.fn().mockResolvedValue({ ok: true, removed_count: 1 }),
    createLabel: vi.fn(),
    updateLabel: vi.fn(),
    startAutolabel: vi.fn(),
    getAutolabelStatus: vi.fn().mockResolvedValue({ running: false, processed: 0, total: 0, error: null }),
    suggestLabel: vi.fn().mockResolvedValue({ label_name: '', evidence: '', rationale: '' }),
    getQueuePosition: vi.fn().mockResolvedValue({ position: 1, total_remaining: 86 }),
    getRecentHistory: vi.fn().mockResolvedValue([]),
    unskipMessage: vi.fn().mockResolvedValue(undefined),
    reorderLabels: vi.fn().mockResolvedValue(undefined),
    getMessage: vi.fn().mockResolvedValue({ chatlog_id: 1, message_index: 0, message_text: 'Test', context_before: null, context_after: null }),
    getCandidates: vi.fn().mockResolvedValue([]),
    discoverConcepts: vi.fn().mockResolvedValue({ run_id: '123', status: 'running' }),
    getEmbedStatus: vi.fn().mockResolvedValue({ cached: 0, total_unlabeled: 0, running: false }),
    archiveLabel: vi.fn().mockResolvedValue({ archived_at: '', messages_returned_to_queue: 0 }),
    getLabelReview: vi.fn().mockResolvedValue([]),
    getSkippedMessages: vi.fn().mockResolvedValue([]),
    getConversationMessages: vi.fn().mockResolvedValue([]),
    getAnalysisSummary: vi.fn().mockResolvedValue({}),
    getTemporalAnalysis: vi.fn().mockResolvedValue({}),
    getRecalibration: vi.fn().mockResolvedValue(null),
    getRecalibrationStats: vi.fn().mockResolvedValue(null),
    saveRecalibration: vi.fn().mockResolvedValue({ matched: true, trend: 'steady' }),
    resolveCandidate: vi.fn().mockResolvedValue(undefined),
    getOrphanedMessages: vi.fn().mockResolvedValue({ messages: [], count: 0 }),
  },
}))
const renderQueue = () => render(<MemoryRouter><QueuePage /></MemoryRouter>)

test('pressing "s" calls skipMessage', async () => {
  mockSkipMessage.mockClear()
  renderQueue()
  await waitFor(() => screen.getByText('Test message'))
  fireEvent.keyDown(document, { key: 's' })
  expect(mockSkipMessage).toHaveBeenCalledWith(1, 0)
})

test('pressing "1" applies the first label', async () => {
  mockApplyLabel.mockClear()
  renderQueue()
  await waitFor(() => screen.getByText('Test message'))
  await waitFor(() => {
    fireEvent.keyDown(document, { key: '1' })
    expect(mockApplyLabel).toHaveBeenCalledWith(
      expect.objectContaining({ label_id: 1 })
    )
  })
})

test('pressing "2" applies the second label', async () => {
  mockApplyLabel.mockClear()
  renderQueue()
  await waitFor(() => screen.getByText('Test message'))
  fireEvent.keyDown(document, { key: '2' })
  expect(mockApplyLabel).toHaveBeenCalledWith(
    expect.objectContaining({ label_id: 2 })
  )
})

test('pressing "9" does nothing when fewer than 9 labels exist', async () => {
  mockApplyLabel.mockClear()
  renderQueue()
  await waitFor(() => screen.getByText('Test message'))
  fireEvent.keyDown(document, { key: '9' })
  expect(mockApplyLabel).not.toHaveBeenCalled()
})

test('shortcuts do not fire when an input is focused', async () => {
  mockSkipMessage.mockClear()
  renderQueue()
  await waitFor(() => screen.getByText('Test message'))
  fireEvent.click(screen.getByText('+ New label'))
  const input = screen.getByPlaceholderText('Label name (required)')
  input.focus()
  fireEvent.keyDown(document, { key: 's' })
  expect(mockSkipMessage).not.toHaveBeenCalled()
})
