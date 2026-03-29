import { render, screen } from '@testing-library/react'
import { ProgressSidebar } from '../components/queue/ProgressSidebar'
import { mockApi } from '../mocks'

const mockStats = { total_messages: 100, labeled_count: 14, skipped_count: 0 }

test('shows labeled count and total', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      stats={mockStats}
      skippedCount={0}
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
    />
  )
  expect(screen.getByText('Skipped: 5')).toBeInTheDocument()
})

test('renders all label names', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      stats={mockStats}
      skippedCount={0}
    />
  )
  expect(screen.getByText('Concept Question')).toBeInTheDocument()
  expect(screen.getByText('Clarification')).toBeInTheDocument()
})

test('shows AI unlock progress when under 50', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      stats={mockStats}
      skippedCount={0}
    />
  )
  expect(screen.getByText('14 / 50 to unlock')).toBeInTheDocument()
})
