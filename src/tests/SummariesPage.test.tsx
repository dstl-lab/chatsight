import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { SummariesPageMulti } from '../pages/summaries/SummariesPageMulti'
import type { HandoffSummaryItem } from '../types'

const inflight: HandoffSummaryItem = {
  label_id: 1,
  label_name: 'validation',
  description: 'Asking whether their answer is correct',
  phase: 'classifying',
  yes_count: 0,
  no_count: 0,
  review_count: 0,
  review_threshold: 0.7,
  included: [],
  excluded: [],
  classified_count: 0,
  classification_total: 17416,
  error: null,
  error_kind: null,
  batch_state: 'JOB_STATE_RUNNING',
  batch_submitted_at: new Date(Date.now() - 65_000).toISOString(),
  batch_polled_at: new Date(Date.now() - 5_000).toISOString(),
  batch_total_count: null,
  batch_completed_count: null,
}

const inflightStale: HandoffSummaryItem = {
  ...inflight,
  label_id: 2,
  label_name: 'stale-task',
  batch_polled_at: new Date(Date.now() - 90_000).toISOString(),
}

const parallel: HandoffSummaryItem = {
  label_id: 3,
  label_name: 'small-job',
  description: null,
  phase: 'classifying',
  yes_count: 0,
  no_count: 0,
  review_count: 0,
  review_threshold: 0.7,
  included: [],
  excluded: [],
  classified_count: 12,
  classification_total: 50,
  error: null,
  error_kind: null,
  batch_state: null,
  batch_submitted_at: null,
  batch_polled_at: null,
  batch_total_count: null,
  batch_completed_count: null,
}

// Multi-batch handoff (N=5), first sub-batch landed → 1 of 5 done, real 23% bar.
const multiBatchPartial: HandoffSummaryItem = {
  ...inflight,
  label_id: 4,
  label_name: 'multi-validation',
  classified_count: 4000,
  classification_total: 17416,
  batch_total_count: 5,
  batch_completed_count: 1,
}

// Multi-batch handoff (N=5), nothing landed yet → indeterminate strip.
const multiBatchPreLand: HandoffSummaryItem = {
  ...inflight,
  label_id: 5,
  label_name: 'multi-validation-pre',
  classified_count: 0,
  classification_total: 17416,
  batch_total_count: 5,
  batch_completed_count: 0,
}

const { mockListHandoffSummaries } = vi.hoisted(() => ({
  mockListHandoffSummaries: vi.fn(),
}))

vi.mock('../services/api', () => ({
  api: {
    listHandoffSummaries: mockListHandoffSummaries,
    retryHandoffSingleLabel: vi.fn(),
  },
}))

beforeEach(() => {
  mockListHandoffSummaries.mockReset()
})

test('renders the batch-in-flight UI (state + elapsed) for a batch job', async () => {
  mockListHandoffSummaries.mockResolvedValue([inflight])
  render(<SummariesPageMulti />)

  await waitFor(() => {
    expect(screen.getByText(/Classifying · Gemini batch · Running/i)).toBeInTheDocument()
  })

  // Indeterminate UI present
  expect(screen.getByTestId('batch-inflight-block')).toBeInTheDocument()
  expect(
    screen.getByRole('progressbar', { name: /Gemini batch in progress/i }),
  ).toBeInTheDocument()

  // The misleading "0%" label is suppressed in the in-flight path.
  expect(screen.queryByText('0%')).not.toBeInTheDocument()
  // The misleading "0 of 17416" badge text is suppressed too.
  expect(screen.queryByText(/0 of 17416/)).not.toBeInTheDocument()

  // Elapsed time chip is present (1m 5s from our seed).
  const elapsed = screen.getByTestId('batch-elapsed')
  expect(elapsed.textContent ?? '').toMatch(/m\s+\d+s/)
})

test('shows a stale-poll hint when the backend has not polled recently', async () => {
  mockListHandoffSummaries.mockResolvedValue([inflightStale])
  render(<SummariesPageMulti />)

  await waitFor(() => {
    expect(screen.getByTestId('batch-stale-hint')).toBeInTheDocument()
  })
  expect(screen.getByTestId('batch-stale-hint').textContent ?? '').toMatch(
    /may have stalled/i,
  )
})

test('parallel-path classifying still renders the % bar (no batch UI)', async () => {
  mockListHandoffSummaries.mockResolvedValue([parallel])
  render(<SummariesPageMulti />)

  await waitFor(() => {
    expect(screen.getByText('24%')).toBeInTheDocument()
  })

  // No batch UI rendered.
  expect(screen.queryByTestId('batch-inflight-block')).not.toBeInTheDocument()
  expect(screen.queryByTestId('batch-elapsed')).not.toBeInTheDocument()
})

test('multi-batch handoff: real % bar + "X of N batches" once first sub-batch lands', async () => {
  mockListHandoffSummaries.mockResolvedValue([multiBatchPartial])
  render(<SummariesPageMulti />)

  await waitFor(() => {
    expect(screen.getByTestId('batch-counts')).toBeInTheDocument()
  })

  // "1 of 5 batches done" is wired up.
  expect(screen.getByTestId('batch-counts').textContent ?? '').toMatch(/1 of 5 batches done/)
  // Real % bar is rendered (not the indeterminate strip).
  expect(screen.getByTestId('batch-real-bar')).toBeInTheDocument()
  // Real % chip is also surfaced next to the elapsed-time chip.
  const pctChip = screen.getByTestId('batch-progress-pct')
  expect(pctChip.textContent ?? '').toMatch(/23%/)
  // Elapsed time is still shown — useful even with a real bar.
  expect(screen.getByTestId('batch-elapsed')).toBeInTheDocument()
})

test('multi-batch handoff: indeterminate strip before any sub-batch lands', async () => {
  mockListHandoffSummaries.mockResolvedValue([multiBatchPreLand])
  render(<SummariesPageMulti />)

  await waitFor(() => {
    expect(screen.getByTestId('batch-counts')).toBeInTheDocument()
  })

  // "0 of 5 batches done" is shown to convey scope before anything lands.
  expect(screen.getByTestId('batch-counts').textContent ?? '').toMatch(/0 of 5 batches done/)
  // No real % bar yet — indeterminate strip path.
  expect(screen.queryByTestId('batch-real-bar')).not.toBeInTheDocument()
  expect(screen.queryByTestId('batch-progress-pct')).not.toBeInTheDocument()
})
