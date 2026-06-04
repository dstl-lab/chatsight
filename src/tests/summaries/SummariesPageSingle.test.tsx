import { render, screen, act } from '@testing-library/react'
import { vi, beforeEach, afterEach, test, expect } from 'vitest'
import { SummariesPageSingle } from '../../pages/summaries/SummariesPageSingle'
import type { HandoffSummaryItem } from '../../types'

const { mockListSummaries, mockGetDetail } = vi.hoisted(() => ({
  mockListSummaries: vi.fn(),
  mockGetDetail: vi.fn(),
}))

vi.mock('../../services/api', () => ({
  api: {
    listHandoffSummaries: mockListSummaries,
    getSingleLabelDetail: mockGetDetail,
    exportOneHotCsv: vi.fn(),
  },
}))

function item(overrides: Partial<HandoffSummaryItem> = {}): HandoffSummaryItem {
  return {
    label_id: 9,
    label_name: 'verification',
    description: null,
    phase: 'classifying',
    yes_count: 0,
    no_count: 0,
    review_count: 0,
    review_threshold: 0.7,
    included: [],
    excluded: [],
    classified_count: 350,
    classification_total: 3500,
    error: null,
    error_kind: null,
    batch_state: null,
    batch_submitted_at: null,
    batch_polled_at: null,
    batch_total_count: null,
    batch_completed_count: null,
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
  mockGetDetail.mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks() // also drains any unconsumed mockResolvedValueOnce queue
})

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

test('progress auto-updates while a label is classifying, without remounting', async () => {
  mockListSummaries
    .mockResolvedValueOnce([item({ classified_count: 350 })]) // mount → 10%
    .mockResolvedValueOnce([item({ classified_count: 700 })]) // poll → 20%

  render(<SummariesPageSingle />)

  await tick(0) // flush mount fetch
  expect(screen.getByText(/10%/)).toBeInTheDocument()

  await tick(2000) // one poll tick
  expect(screen.getByText(/20%/)).toBeInTheDocument()
})

test('polling stops once nothing is classifying', async () => {
  mockListSummaries
    .mockResolvedValueOnce([item({ classified_count: 350 })]) // mount → classifying
    .mockResolvedValueOnce([
      item({ phase: 'handed_off', classified_count: 3500, yes_count: 1000, no_count: 2500 }),
    ]) // poll → done
    .mockResolvedValue([item({ phase: 'handed_off', classified_count: 3500 })])

  render(<SummariesPageSingle />)
  await tick(0)
  expect(screen.getByText(/10%/)).toBeInTheDocument()

  await tick(2000) // poll observes handed_off → should stop polling
  const callsAfterDone = mockListSummaries.mock.calls.length

  await tick(2000 * 5) // idle page should not poll further
  expect(mockListSummaries.mock.calls.length).toBe(callsAfterDone)
})
