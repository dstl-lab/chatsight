// src/tests/MessageCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MessageCard } from '../components/queue/MessageCard'
import { mockApi } from '../mocks'

const item = mockApi.queue[0]

test('renders student message text', () => {
  render(<MessageCard item={item} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  expect(screen.getByText(item.message_text)).toBeInTheDocument()
})

test('shows AI lock indicator when not unlocked', () => {
  render(<MessageCard item={item} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  expect(screen.getByText(/AI unlocks at 50/i)).toBeInTheDocument()
})

test('shows ghost tag with why? when AI unlocked and suggestion present', () => {
  render(<MessageCard item={item} aiUnlocked={true} suggestion={mockApi.suggestion} onSkip={() => {}} />)
  expect(screen.getByText(/Concept Question/)).toBeInTheDocument()
  expect(screen.getByText(/why\?/i)).toBeInTheDocument()
})

test('expands rationale when why? is clicked', () => {
  render(<MessageCard item={item} aiUnlocked={true} suggestion={mockApi.suggestion} onSkip={() => {}} />)
  fireEvent.click(screen.getByText(/why\?/i))
  expect(screen.getByText(mockApi.suggestion.rationale)).toBeInTheDocument()
})

test('calls onSkip when skip button clicked', () => {
  const onSkip = vi.fn()
  render(<MessageCard item={item} aiUnlocked={false} suggestion={null} onSkip={onSkip} />)
  fireEvent.click(screen.getByText(/skip/i))
  expect(onSkip).toHaveBeenCalledOnce()
})
