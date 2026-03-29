import { render, screen } from '@testing-library/react'
import { LabelStrip } from '../components/queue/LabelStrip'
import { mockApi } from '../mocks'

test('renders label names with counts', () => {
  render(<LabelStrip labels={mockApi.labels} />)
  expect(screen.getByText('Concept Question')).toBeInTheDocument()
  expect(screen.getByText('5')).toBeInTheDocument()
  expect(screen.getByText('Clarification')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
})

test('renders nothing when no labels', () => {
  const { container } = render(<LabelStrip labels={[]} />)
  expect(container.firstChild).toBeNull()
})
