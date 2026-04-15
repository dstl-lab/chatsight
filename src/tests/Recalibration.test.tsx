import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, beforeEach } from 'vitest'
import { QueuePage } from '../pages/QueuePage'

const {
  mockGetRecalibration,
  mockSaveRecalibration,
  mockGetRecalibrationStats,
} = vi.hoisted(() => ({
  mockGetRecalibration: vi.fn().mockResolvedValue(null),
  mockSaveRecalibration: vi.fn().mockResolvedValue({ matched: true, trend: 'steady' }),
  mockGetRecalibrationStats: vi.fn().mockResolvedValue(null),
}))

vi.mock('../services/api', () => ({
  api: {
    startSession: vi.fn().mockResolvedValue({ id: 1, started_at: '', last_active: '', labeled_count: 25 }),
    getLabels: vi.fn().mockResolvedValue([
      { id: 1, name: 'Concept Question', description: null, created_at: '', count: 5 },
      { id: 2, name: 'Debug Help', description: null, created_at: '', count: 3 },
    ]),
    getQueue: vi.fn().mockResolvedValue([
      { chatlog_id: 1, message_index: 0, message_text: 'First message', context_before: null, context_after: null },
      { chatlog_id: 1, message_index: 1, message_text: 'Second message', context_before: null, context_after: null },
    ]),
    getQueueStats: vi.fn().mockResolvedValue({ total_messages: 100, labeled_count: 25, skipped_count: 0 }),
    getQueuePosition: vi.fn().mockResolvedValue({ position: 1, total_remaining: 75 }),
    getRecentHistory: vi.fn().mockResolvedValue([]),
    getCandidates: vi.fn().mockResolvedValue([]),
    getRecalibration: mockGetRecalibration,
    saveRecalibration: mockSaveRecalibration,
    getRecalibrationStats: mockGetRecalibrationStats,
    getAppliedLabels: vi.fn().mockResolvedValue([]),
    applyLabel: vi.fn().mockResolvedValue(undefined),
    unapplyLabel: vi.fn().mockResolvedValue(undefined),
    skipMessage: vi.fn().mockResolvedValue(undefined),
    unskipMessage: vi.fn().mockResolvedValue(undefined),
    advanceMessage: vi.fn().mockResolvedValue({ ok: true, counted: true }),
    undoLabels: vi.fn().mockResolvedValue({ ok: true, removed_count: 0 }),
    createLabel: vi.fn(),
    updateLabel: vi.fn(),
    suggestLabel: vi.fn().mockResolvedValue({ label_name: '', evidence: '', rationale: '' }),
    startAutolabel: vi.fn(),
    getAutolabelStatus: vi.fn().mockResolvedValue({ running: false, processed: 0, total: 0, error: null }),
    getEmbedStatus: vi.fn().mockResolvedValue({ cached: 0, total_unlabeled: 0, running: false }),
    discoverConcepts: vi.fn().mockResolvedValue(undefined),
    resolveCandidate: vi.fn().mockResolvedValue(undefined),
    reorderLabels: vi.fn().mockResolvedValue(undefined),
    getOrphanedMessages: vi.fn().mockResolvedValue({ messages: [], count: 0 }),
    archiveLabel: vi.fn().mockResolvedValue({ archived_at: '', messages_returned_to_queue: 0 }),
    getMessage: vi.fn().mockResolvedValue({
      chatlog_id: 1, message_index: 0, message_text: 'Test',
      context_before: null, context_after: null,
    }),
  },
}))

const recalItem = {
  chatlog_id: 42,
  message_index: 0,
  message_text: 'Re-label this message',
  context_before: null,
  context_after: null,
  original_label_ids: [1], // "Concept Question"
}

const renderQueue = () => render(<MemoryRouter><QueuePage /></MemoryRouter>)

// Drive the UI into the blind recalibration phase. Starts from a fresh render,
// applies a label to the first queue item, clicks Next, then waits for the
// recalibration banner to appear (which happens after getRecalibration resolves).
async function enterBlindPhase() {
  renderQueue()
  await waitFor(() => screen.getByText('First message'))
  fireEvent.click(screen.getByRole('button', { name: /Concept Question/ }))
  await waitFor(() => {
    const next = screen.getByText('Next →')
    expect(next).not.toBeDisabled()
  })
  fireEvent.click(screen.getByText('Next →'))
  await waitFor(() => screen.getByText('RECALIBRATION'))
}

beforeEach(() => {
  mockGetRecalibration.mockReset()
  mockSaveRecalibration.mockReset()
  mockGetRecalibrationStats.mockReset()
  mockGetRecalibration.mockResolvedValue(recalItem)
  mockSaveRecalibration.mockResolvedValue({ matched: true, trend: 'steady' })
  mockGetRecalibrationStats.mockResolvedValue(null)
})

test('enters blind phase and shows the recalibration banner', async () => {
  await enterBlindPhase()
  expect(screen.getByText('RECALIBRATION')).toBeInTheDocument()
  expect(screen.getByText('Re-label this message')).toBeInTheDocument()
})

test('matching labels saves a matched recalibration event and shows the match toast', async () => {
  await enterBlindPhase()
  // Original labels = [1]; click "Concept Question" (id=1) to match
  fireEvent.click(screen.getByRole('button', { name: /Concept Question/ }))
  await waitFor(() => {
    expect(screen.getByText('Next →')).not.toBeDisabled()
  })
  fireEvent.click(screen.getByText('Next →'))

  await waitFor(() => {
    expect(mockSaveRecalibration).toHaveBeenCalledWith(expect.objectContaining({
      chatlog_id: 42,
      message_index: 0,
      original_label_ids: [1],
      relabel_ids: [1],
      final_label_ids: [1],
    }))
  })
  await waitFor(() => screen.getByText(/Consistent/))
  expect(screen.queryByText('RECALIBRATION')).not.toBeInTheDocument()
})

test('mismatched labels enter reconcile phase without saving', async () => {
  await enterBlindPhase()
  // Original labels = [1]; click a different label (id=2)
  fireEvent.click(screen.getByRole('button', { name: /Debug Help/ }))
  await waitFor(() => {
    expect(screen.getByText('Next →')).not.toBeDisabled()
  })
  fireEvent.click(screen.getByText('Next →'))

  await waitFor(() => screen.getByText('MISMATCH'))
  expect(screen.getByText('Reconcile Labels')).toBeInTheDocument()
  expect(mockSaveRecalibration).not.toHaveBeenCalled()
})

test('confirming in reconcile phase saves the final label set', async () => {
  await enterBlindPhase()
  fireEvent.click(screen.getByRole('button', { name: /Debug Help/ })) // mismatch
  await waitFor(() => {
    expect(screen.getByText('Next →')).not.toBeDisabled()
  })
  fireEvent.click(screen.getByText('Next →'))
  await waitFor(() => screen.getByText('MISMATCH'))

  // In reconcile, the Next button becomes "Confirm →". Click it to save.
  fireEvent.click(screen.getByText('Confirm →'))

  await waitFor(() => {
    expect(mockSaveRecalibration).toHaveBeenCalledWith(expect.objectContaining({
      chatlog_id: 42,
      message_index: 0,
      original_label_ids: [1],
      relabel_ids: [2],
      final_label_ids: [2],
    }))
  })
  expect(screen.queryByText('MISMATCH')).not.toBeInTheDocument()
})

test('Escape in blind phase cancels without saving', async () => {
  await enterBlindPhase()
  fireEvent.keyDown(window, { key: 'Escape' })
  await waitFor(() => {
    expect(screen.queryByText('RECALIBRATION')).not.toBeInTheDocument()
  })
  expect(mockSaveRecalibration).not.toHaveBeenCalled()
})

test('Escape in reconcile phase saves the original labels as final', async () => {
  await enterBlindPhase()
  fireEvent.click(screen.getByRole('button', { name: /Debug Help/ }))
  await waitFor(() => expect(screen.getByText('Next →')).not.toBeDisabled())
  fireEvent.click(screen.getByText('Next →'))
  await waitFor(() => screen.getByText('MISMATCH'))

  fireEvent.keyDown(window, { key: 'Escape' })

  await waitFor(() => {
    expect(mockSaveRecalibration).toHaveBeenCalledWith(expect.objectContaining({
      chatlog_id: 42,
      original_label_ids: [1],
      relabel_ids: [2],
      final_label_ids: [1],
    }))
  })
  expect(screen.queryByText('MISMATCH')).not.toBeInTheDocument()
})
