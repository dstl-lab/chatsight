import { render, screen, fireEvent } from '../test-utils'
import { vi } from 'vitest'
import { MessageList } from '../../components/summaries/MessageList'
import type { MessageListItem } from '../../types'

const items: MessageListItem[] = [
  { chatlog_id: 1, message_index: 0, text: 'wait, I think I misread',
    confidence: 0.58, verdict: 'yes', applied_by: 'ai', flagged: false, has_note: false, notebook: null },
  { chatlog_id: 2, message_index: 0, text: 'never mind the typo on line 4',
    confidence: 0.78, verdict: 'yes', applied_by: 'ai', flagged: false, has_note: true, notebook: null },
  { chatlog_id: 3, message_index: 0, text: 'flagged: can you help me with part 2',
    confidence: 0.15, verdict: 'no', applied_by: 'ai', flagged: true, has_note: false, notebook: null },
  { chatlog_id: 4, message_index: 0, text: 'human reviewed this one',
    confidence: 0.42, verdict: 'no', applied_by: 'human', flagged: false, has_note: false, notebook: null },
]

test('renders one row per item', () => {
  render(<MessageList items={items} activeKey={null} onSelect={vi.fn()} height={2000} />)
  expect(screen.getByText(/misread/)).toBeInTheDocument()
  expect(screen.getByText(/never mind/)).toBeInTheDocument()
  expect(screen.getByText(/part 2/)).toBeInTheDocument()
})

test('clicking a row emits onSelect with chatlog_id and message_index', () => {
  const onSelect = vi.fn()
  render(<MessageList items={items} activeKey={null} onSelect={onSelect} height={2000} />)
  fireEvent.click(screen.getByText(/never mind/))
  expect(onSelect).toHaveBeenCalledWith({ chatlog_id: 2, message_index: 0 })
})

test('row with note shows a note dot', () => {
  render(<MessageList items={items} activeKey={null} onSelect={vi.fn()} height={2000} />)
  expect(screen.getByTestId('note-dot-2-0')).toBeInTheDocument()
})

test('row with flag shows a flag glyph', () => {
  render(<MessageList items={items} activeKey={null} onSelect={vi.fn()} height={2000} />)
  expect(screen.getByTestId('flag-glyph-3-0')).toBeInTheDocument()
})

test('human-labeled row shows the human glyph', () => {
  render(<MessageList items={items} activeKey={null} onSelect={vi.fn()} height={2000} />)
  expect(screen.getByTestId('applied-by-human-4-0')).toBeInTheDocument()
})

test('ai-labeled row shows no human glyph', () => {
  render(<MessageList items={items} activeKey={null} onSelect={vi.fn()} height={2000} />)
  expect(screen.queryByTestId('applied-by-human-1-0')).not.toBeInTheDocument()
})

test('null applied_by row shows no human glyph', () => {
  const nullItems = [{ ...items[0], chatlog_id: 99, applied_by: null }]
  render(<MessageList items={nullItems} activeKey={null} onSelect={vi.fn()} height={2000} />)
  expect(screen.queryByTestId('applied-by-human-99-0')).not.toBeInTheDocument()
})
