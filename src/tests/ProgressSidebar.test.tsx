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
  onStartAutolabel: noop,
  autolabelStatus: null,
  remaining: null,
  history: [],
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

test('shows AI suggestions unlock progress', () => {
  render(<ProgressSidebar {...defaultProps} />)
  expect(screen.getByText('14 / 20 to unlock')).toBeInTheDocument()
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
  // Label "Concept Question" has count 5, "Clarification" has count 3
  const conceptBtn = screen.getByRole('button', { name: /Concept Question/ })
  expect(conceptBtn.querySelector('.rounded-full')).toHaveTextContent('5')
  const clarifyBtn = screen.getByRole('button', { name: /Clarification/ })
  expect(clarifyBtn.querySelector('.rounded-full')).toHaveTextContent('3')
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

const historyItems = [
  { chatlog_id: 1, message_index: 0, message_text: 'Short message', context_before: null, context_after: null, labels: ['Concept Q'], status: 'labeled' as const, processed_at: '' },
  { chatlog_id: 2, message_index: 1, message_text: 'A'.repeat(80), context_before: null, context_after: null, labels: ['Debug', 'Clarify'], status: 'labeled' as const, processed_at: '' },
]

test('does not render Recent section when history is empty', () => {
  render(<ProgressSidebar {...defaultProps} history={[]} />)
  expect(screen.queryByText(/recent/i)).not.toBeInTheDocument()
})

test('renders Recent toggle button when history has items', () => {
  render(<ProgressSidebar {...defaultProps} history={historyItems} />)
  expect(screen.getByText(/recent/i)).toBeInTheDocument()
})

test('history items not visible before expanding', () => {
  render(<ProgressSidebar {...defaultProps} history={historyItems} />)
  expect(screen.queryByText('Short message')).not.toBeInTheDocument()
})

test('history items visible after clicking Recent toggle', () => {
  render(<ProgressSidebar {...defaultProps} history={historyItems} />)
  fireEvent.click(screen.getByText(/recent/i))
  expect(screen.getByText('Short message')).toBeInTheDocument()
})

test('long message text is truncated to 50 chars', () => {
  render(<ProgressSidebar {...defaultProps} history={historyItems} />)
  fireEvent.click(screen.getByText(/recent/i))
  const truncated = screen.getByText((content) => content.startsWith('A'.repeat(50)))
  expect(truncated).toBeInTheDocument()
})

test('label names are shown under each history item', () => {
  render(<ProgressSidebar {...defaultProps} history={historyItems} />)
  fireEvent.click(screen.getByText(/recent/i))
  expect(screen.getByText('Debug, Clarify')).toBeInTheDocument()
})
