import { render, screen, fireEvent } from '@testing-library/react'
import { MessageCard } from '../components/queue/MessageCard'
import { mockApi } from '../mocks'
import type { QueueItem } from '../types'

const item = mockApi.queue[0]
const noop = () => {}

const defaultProps = {
  item,
  aiUnlocked: false,
  suggestion: null as null,
  onSkip: noop,
  onNext: noop,
  hasLabelsApplied: false,
}

const longItem: QueueItem = {
  chatlog_id: 99,
  message_index: 5,
  message_text: 'What does this mean?',
  context_before:
    "# Introduction to DataFrames\n\nA **DataFrame** is a two-dimensional, size-mutable, and potentially heterogeneous tabular data structure with labeled axes (rows and columns). Think of it like a spreadsheet or SQL table. You can create one from a dictionary: `df = pd.DataFrame({'name': ['Alice', 'Bob'], 'age': [25, 30]})`. Each column is a **Series** object. Try running the code above to see the result.",
  context_after:
    "Great question! Let me break it down further.\n\n## Key Differences\n\n1. **Type flexibility**: Unlike Python lists, DataFrames can hold different types in each column\n2. **Labeled access**: You can access data by column name like `df['age']`\n3. **Built-in methods**: DataFrames come with `.describe()`, `.groupby()`, and many other analytical methods that lists don't have.",
}

test('renders student message text', () => {
  render(<MessageCard {...defaultProps} />)
  expect(screen.getByText(item.message_text)).toBeInTheDocument()
})

test('shows AI lock indicator when not unlocked', () => {
  render(<MessageCard {...defaultProps} />)
  expect(screen.getByText(/AI unlocks at 50/i)).toBeInTheDocument()
})

test('shows ghost tag when AI unlocked with suggestion', () => {
  render(<MessageCard {...defaultProps} aiUnlocked={true} suggestion={mockApi.suggestion} />)
  expect(screen.getByText(/Concept Question/)).toBeInTheDocument()
  expect(screen.getByText(/why\?/i)).toBeInTheDocument()
})

test('expands rationale when why? is clicked', () => {
  render(<MessageCard {...defaultProps} aiUnlocked={true} suggestion={mockApi.suggestion} />)
  fireEvent.click(screen.getByText(/why\?/i))
  expect(screen.getByText(mockApi.suggestion.rationale)).toBeInTheDocument()
})

test('calls onSkip when skip button clicked', () => {
  const onSkip = vi.fn()
  render(<MessageCard {...defaultProps} onSkip={onSkip} />)
  fireEvent.click(screen.getByText(/^skip$/i))
  expect(onSkip).toHaveBeenCalledOnce()
})

test('Next button is disabled when no labels applied', () => {
  render(<MessageCard {...defaultProps} hasLabelsApplied={false} />)
  const nextBtn = screen.getByText(/next/i)
  expect(nextBtn).toBeDisabled()
})

test('Next button calls onNext when labels applied', () => {
  const onNext = vi.fn()
  render(<MessageCard {...defaultProps} onNext={onNext} hasLabelsApplied={true} />)
  fireEvent.click(screen.getByText(/next/i))
  expect(onNext).toHaveBeenCalledOnce()
})

test('context is collapsed by default showing preview text', () => {
  render(<MessageCard {...defaultProps} item={longItem} />)
  expect(screen.queryByText('Introduction to DataFrames')).not.toBeInTheDocument()
  expect(screen.getAllByText(/expand/).length).toBeGreaterThan(0)
})

test('clicking collapsed context expands to show full markdown', () => {
  render(<MessageCard {...defaultProps} item={longItem} />)
  fireEvent.click(screen.getByText(/Preceding AI response/).closest('div')!)
  expect(screen.getByText('Introduction to DataFrames')).toBeInTheDocument()
})

test('context_before preview shows tail of text', () => {
  render(<MessageCard {...defaultProps} item={longItem} />)
  const preview = screen.getByText(/^\.\.\./)
  expect(preview).toBeInTheDocument()
  expect(preview.textContent).toContain('Try running the code above')
})

test('context_after preview shows head of text', () => {
  render(<MessageCard {...defaultProps} item={longItem} />)
  const previews = screen.getAllByText(/Great question/)
  expect(previews.length).toBeGreaterThan(0)
})
