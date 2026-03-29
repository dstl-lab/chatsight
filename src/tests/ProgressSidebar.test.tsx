import { render, screen, fireEvent } from '@testing-library/react'
import { ProgressSidebar } from '../components/queue/ProgressSidebar'
import { mockApi } from '../mocks'

const mockStats = { total_messages: 100, labeled_count: 14, skipped_count: 0 }
const noop = () => {}

test('shows labeled count and total', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      stats={mockStats}
      skippedCount={0}
      onApply={noop}
      onCreateAndApply={noop}
    />
  )
  expect(screen.getByText('14')).toBeInTheDocument()
  expect(screen.getByText(/100/)).toBeInTheDocument()
})

test('shows skipped count when non-zero', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      stats={mockStats}
      skippedCount={5}
      onApply={noop}
      onCreateAndApply={noop}
    />
  )
  expect(screen.getByText('Skipped: 5')).toBeInTheDocument()
})

test('shows AI unlock progress when under 50', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      stats={mockStats}
      skippedCount={0}
      onApply={noop}
      onCreateAndApply={noop}
    />
  )
  expect(screen.getByText('14 / 50 to unlock')).toBeInTheDocument()
})

test('renders clickable label buttons', () => {
  const onApply = vi.fn()
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      stats={mockStats}
      skippedCount={0}
      onApply={onApply}
      onCreateAndApply={noop}
    />
  )
  const btn = screen.getByRole('button', { name: 'Concept Question' })
  expect(btn).toBeInTheDocument()
  fireEvent.click(btn)
  expect(onApply).toHaveBeenCalledWith(1)
})

test('shows + New label button', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      stats={mockStats}
      skippedCount={0}
      onApply={noop}
      onCreateAndApply={noop}
    />
  )
  expect(screen.getByText('+ New label')).toBeInTheDocument()
})

test('opens new label popover when + New label clicked', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      stats={mockStats}
      skippedCount={0}
      onApply={noop}
      onCreateAndApply={noop}
    />
  )
  fireEvent.click(screen.getByText('+ New label'))
  expect(screen.getByPlaceholderText('Label name (required)')).toBeInTheDocument()
})
