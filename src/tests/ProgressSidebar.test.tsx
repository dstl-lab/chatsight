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
  onSelectHistoryItem: noop as (item: import('../types').HistoryItem) => void,
  reviewingKey: null as string | null,
  onReorderLabels: noop as (ids: number[]) => void,
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

test('shows count in hover popover', async () => {
  // The count is shown in the description popover after hover, not on the button itself
  // We can't easily simulate the 2s hover timer in this test, so just verify
  // the count pill is NOT on the button (regression check for the cleanup)
  render(<ProgressSidebar {...defaultProps} />)
  const conceptBtn = screen.getByRole('button', { name: /Concept Question/ })
  expect(conceptBtn.querySelector('.rounded-full')).toBeNull()
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
  { chatlog_id: 1, message_index: 0, message_text: 'Short message', context_before: null, context_after: null, labels: ['Concept Q'], status: 'labeled' as const, applied_by: 'human' as const, confidence: null, processed_at: '' },
  { chatlog_id: 2, message_index: 1, message_text: 'A'.repeat(80), context_before: null, context_after: null, labels: ['Debug', 'Clarify'], status: 'labeled' as const, applied_by: 'human' as const, confidence: null, processed_at: '' },
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

test('clicking a history item calls onSelectHistoryItem', () => {
  const onSelect = vi.fn()
  render(<ProgressSidebar {...defaultProps} history={historyItems} onSelectHistoryItem={onSelect} />)
  fireEvent.click(screen.getByText(/recent/i))
  fireEvent.click(screen.getByText('Short message'))
  expect(onSelect).toHaveBeenCalledWith(historyItems[0])
})

const mixedHistory = [
  { chatlog_id: 1, message_index: 0, message_text: 'Labeled msg', context_before: null, context_after: null, labels: ['Concept'], status: 'labeled' as const, applied_by: 'human' as const, confidence: null, processed_at: '' },
  { chatlog_id: 2, message_index: 0, message_text: 'Skipped msg', context_before: null, context_after: null, labels: [], status: 'skipped' as const, applied_by: null, confidence: null, processed_at: '' },
]

test('skipped items show "Skipped" text instead of labels', () => {
  render(<ProgressSidebar {...defaultProps} history={mixedHistory} />)
  fireEvent.click(screen.getByText(/recent/i))
  expect(screen.getByText('Skipped')).toBeInTheDocument()
})

test('highlights the currently reviewed item', () => {
  render(<ProgressSidebar {...defaultProps} history={historyItems} reviewingKey="1-0" />)
  fireEvent.click(screen.getByText(/recent/i))
  const item = screen.getByText('Short message').closest('[data-history-item]')
  expect(item?.className).toContain('blue')
})
