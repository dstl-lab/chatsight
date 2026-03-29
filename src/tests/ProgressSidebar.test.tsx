import { render, screen, fireEvent } from '@testing-library/react'
import { ProgressSidebar } from '../components/queue/ProgressSidebar'
import { mockApi } from '../mocks'

const mockStats = { total_messages: 100, labeled_count: 14, skipped_count: 0 }
const noop = () => {}

const defaultProps = {
  session: mockApi.session,
  labels: mockApi.labels,
  stats: mockStats,
  skippedCount: 0,
  appliedLabelIds: new Set<number>(),
  onToggleLabel: noop,
  onCreateAndApply: noop,
  onUpdateLabel: noop as (id: number, body: { description?: string }) => void,
}

test('shows labeled count and total', () => {
  render(<ProgressSidebar {...defaultProps} />)
  expect(screen.getByText('14')).toBeInTheDocument()
  expect(screen.getByText(/100/)).toBeInTheDocument()
})

test('shows skipped count when non-zero', () => {
  render(<ProgressSidebar {...defaultProps} skippedCount={5} />)
  expect(screen.getByText('Skipped: 5')).toBeInTheDocument()
})

test('shows AI unlock progress when under 50', () => {
  render(<ProgressSidebar {...defaultProps} />)
  expect(screen.getByText('14 / 50 to unlock')).toBeInTheDocument()
})

test('renders clickable label buttons', () => {
  const onToggleLabel = vi.fn()
  render(<ProgressSidebar {...defaultProps} onToggleLabel={onToggleLabel} />)
  const btn = screen.getByRole('button', { name: /Concept Question/ })
  fireEvent.click(btn)
  expect(onToggleLabel).toHaveBeenCalledWith(1)
})

test('shows count badge on label buttons', () => {
  render(<ProgressSidebar {...defaultProps} />)
  expect(screen.getByText('5')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
})

test('shows selected state for applied labels', () => {
  render(<ProgressSidebar {...defaultProps} appliedLabelIds={new Set([1])} />)
  const btn = screen.getByRole('button', { name: /Concept Question/ })
  expect(btn.className).toContain('blue-500')
})

test('shows + New label button', () => {
  render(<ProgressSidebar {...defaultProps} />)
  expect(screen.getByText('+ New label')).toBeInTheDocument()
})
