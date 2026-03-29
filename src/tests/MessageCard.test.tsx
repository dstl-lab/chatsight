import { render, screen, fireEvent } from '@testing-library/react'
import { MessageCard } from '../components/queue/MessageCard'
import { mockApi } from '../mocks'
import type { QueueItem } from '../types'

const item = mockApi.queue[0]

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

test('context is collapsed by default showing preview text', () => {
  render(<MessageCard item={longItem} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  // Should show truncated preview, not full markdown headers
  expect(screen.queryByText('Introduction to DataFrames')).not.toBeInTheDocument()
  // Should show expand hint
  expect(screen.getAllByText(/expand/).length).toBeGreaterThan(0)
})

test('clicking collapsed context expands to show full markdown', () => {
  render(<MessageCard item={longItem} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  // Click the preceding context block
  fireEvent.click(screen.getByText(/Preceding AI response/).closest('div')!)
  // Now full content should be visible (markdown rendered)
  expect(screen.getByText('Introduction to DataFrames')).toBeInTheDocument()
})

test('clicking expanded context collapses it back', () => {
  render(<MessageCard item={longItem} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  const block = screen.getByText(/Preceding AI response/).closest('div')!
  // Expand
  fireEvent.click(block)
  expect(screen.getByText('Introduction to DataFrames')).toBeInTheDocument()
  // Collapse
  fireEvent.click(block)
  expect(screen.queryByText('Introduction to DataFrames')).not.toBeInTheDocument()
})

test('context_before preview shows tail of text', () => {
  render(<MessageCard item={longItem} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  // Tail truncation starts with ...
  const preview = screen.getByText(/^\.\.\./)
  expect(preview).toBeInTheDocument()
  // Should contain text from the end of context_before
  expect(preview.textContent).toContain('Try running the code above')
})

test('context_after preview shows head of text', () => {
  render(<MessageCard item={longItem} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  // Head truncation: should start with the beginning of context_after
  const previews = screen.getAllByText(/Great question/)
  expect(previews.length).toBeGreaterThan(0)
})

test('preview strips markdown formatting', () => {
  render(<MessageCard item={longItem} aiUnlocked={false} suggestion={null} onSkip={() => {}} />)
  // Raw markdown symbols should not appear in collapsed previews
  const container = document.querySelector('.flex-1.flex.flex-col')!
  const italicPreviews = container.querySelectorAll('p.italic')
  for (const p of italicPreviews) {
    expect(p.textContent).not.toContain('**')
    expect(p.textContent).not.toContain('##')
  }
})
