// src/tests/LabelStrip.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { LabelStrip } from '../components/queue/LabelStrip'
import { mockApi } from '../mocks'

test('renders all label chips', () => {
  render(<LabelStrip labels={mockApi.labels} onApply={() => {}} onCreateAndApply={() => {}} />)
  expect(screen.getByText('Concept Question')).toBeInTheDocument()
  expect(screen.getByText('Clarification')).toBeInTheDocument()
  expect(screen.getByText('Debug Help')).toBeInTheDocument()
})

test('calls onApply with correct id when chip clicked', () => {
  const onApply = vi.fn()
  render(<LabelStrip labels={mockApi.labels} onApply={onApply} onCreateAndApply={() => {}} />)
  fireEvent.click(screen.getByText('Concept Question'))
  expect(onApply).toHaveBeenCalledWith(1)
})

test('shows new label popover when + New label clicked', () => {
  render(<LabelStrip labels={mockApi.labels} onApply={() => {}} onCreateAndApply={() => {}} />)
  fireEvent.click(screen.getByText('+ New label'))
  expect(screen.getByPlaceholderText('Label name (required)')).toBeInTheDocument()
})

test('calls onCreateAndApply when popover confirmed', () => {
  const onCreateAndApply = vi.fn()
  render(<LabelStrip labels={mockApi.labels} onApply={() => {}} onCreateAndApply={onCreateAndApply} />)
  fireEvent.click(screen.getByText('+ New label'))
  fireEvent.change(screen.getByPlaceholderText('Label name (required)'), {
    target: { value: 'New Label' },
  })
  fireEvent.click(screen.getByText('Create & apply'))
  expect(onCreateAndApply).toHaveBeenCalledWith('New Label', undefined)
})
