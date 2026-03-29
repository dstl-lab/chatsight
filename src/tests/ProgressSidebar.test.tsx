// src/tests/ProgressSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { ProgressSidebar } from '../components/queue/ProgressSidebar'
import { mockApi } from '../mocks'

test('shows labeled count and total', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      totalMessages={100}
      skippedCount={0}
    />
  )
  expect(screen.getByText('14 / 100')).toBeInTheDocument()
})

test('shows skipped count when non-zero', () => {
  render(
    <ProgressSidebar
      session={mockApi.session}
      labels={mockApi.labels}
      totalMessages={100}
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
      totalMessages={100}
      skippedCount={0}
    />
  )
  expect(screen.getByText('Concept Question')).toBeInTheDocument()
  expect(screen.getByText('Clarification')).toBeInTheDocument()
})
