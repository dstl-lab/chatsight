import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { LabelRail } from '../../components/summaries/LabelRail'
import type { HandoffSummaryItem } from '../../types'

const items: HandoffSummaryItem[] = [
  { label_id: 1, label_name: 'self-correction', description: 'catches mistakes', phase: 'handed_off',
    yes_count: 1142, no_count: 803, review_count: 91, review_threshold: 0.7,
    included: [], excluded: [], classified_count: null, classification_total: null,
    error: null, error_kind: null, batch_state: null, batch_submitted_at: null,
    batch_polled_at: null, batch_total_count: null, batch_completed_count: null },
  { label_id: 2, label_name: 'validation', description: null, phase: 'classifying',
    yes_count: 0, no_count: 0, review_count: 0, review_threshold: 0.7,
    included: [], excluded: [], classified_count: 4000, classification_total: 17416,
    error: null, error_kind: null, batch_state: 'JOB_STATE_RUNNING',
    batch_submitted_at: new Date().toISOString(), batch_polled_at: new Date().toISOString(),
    batch_total_count: null, batch_completed_count: null },
]

test('renders one row per label with the active id highlighted', () => {
  const onSelect = vi.fn()
  render(<LabelRail items={items} activeId={1} onSelect={onSelect} />)
  expect(screen.getByText('self-correction')).toBeInTheDocument()
  expect(screen.getByText('validation')).toBeInTheDocument()
  expect(screen.getByTestId('rail-row-1')).toHaveAttribute('data-active', 'true')
  expect(screen.getByTestId('rail-row-2')).toHaveAttribute('data-active', 'false')
})

test('clicking a row calls onSelect with the label id', () => {
  const onSelect = vi.fn()
  render(<LabelRail items={items} activeId={1} onSelect={onSelect} />)
  fireEvent.click(screen.getByText('validation'))
  expect(onSelect).toHaveBeenCalledWith(2)
})

test('classifying labels show a progress subtitle', () => {
  render(<LabelRail items={items} activeId={2} onSelect={vi.fn()} />)
  const row = screen.getByTestId('rail-row-2')
  expect(row.textContent ?? '').toMatch(/running|%/i)
})
