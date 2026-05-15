import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { TriageTab } from '../../components/summaries/TriageTab'
import { api } from '../../services/api'
import type { SingleLabelDetail, MessageListItem, MessageDetail } from '../../types'

vi.mock('../../services/api', () => ({
  api: {
    listSingleLabelMessages: vi.fn(),
    getSingleLabelMessageDetail: vi.fn(),
    flipSingleLabelVerdict: vi.fn(),
  },
}))

const detail: SingleLabelDetail = {
  id: 1,
  name: 'self-correction',
  description: null,
  phase: 'complete',
  yes_count: 1142,
  no_count: 803,
  review_count: 47,
  review_threshold: 0.7,
  agreement_vs_gold: 0.87,
  confidence_histogram: [],
}

const item1: MessageListItem = {
  chatlog_id: 100,
  message_index: 4,
  text: 'the mean is 4.2…',
  confidence: 0.63,
  verdict: 'yes',
  applied_by: 'ai',
  flagged: false,
  has_note: false,
  notebook: 'nb1.ipynb',
}

const focused1: MessageDetail = {
  chatlog_id: 100,
  message_index: 4,
  text: 'the mean is 4.2…',
  confidence: 0.63,
  verdict: 'yes',
  applied_by: 'ai',
  matched_pattern: null,
  rationale: null,
  flagged: false,
  note: null,
  context_before: [{ role: 'student', turn_index: 3, text: 'how do I compute the mean' }],
  context_after: [{ role: 'tutor', turn_index: 5, text: 'Right!' }],
  notebook: 'nb1.ipynb',
  turn_index: 4,
  total_turns: 12,
}

beforeEach(() => {
  vi.resetAllMocks()
})

test('renders TriageStrip with progress and HIDDEN = yes+no-review', async () => {
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({
    items: [item1],
    total: 1,
    offset: 0,
    limit: 200,
  })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/1 of 1 to review/)).toBeInTheDocument())
  // hidden = 1142 + 803 - 47 = 1898
  expect(screen.getByText(/1,898 hidden/)).toBeInTheDocument()
})

test('renders ThreadView with focused turn in the middle', async () => {
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({
    items: [item1],
    total: 1,
    offset: 0,
    limit: 200,
  })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())
  expect(screen.getByText(/how do I compute the mean/)).toBeInTheDocument()
  expect(screen.getByText(/Right!/)).toBeInTheDocument()
})

test('shows "all caught up" empty state when items is empty', async () => {
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({
    items: [],
    total: 0,
    offset: 0,
    limit: 200,
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeInTheDocument())
})

test('clicking "Keep YES" (AI=yes) calls flipSingleLabelVerdict("yes") and advances cursor', async () => {
  const items: MessageListItem[] = [
    { ...item1, chatlog_id: 100, message_index: 4 },
    { ...item1, chatlog_id: 101, message_index: 2 },
  ]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({
    items,
    total: items.length,
    offset: 0,
    limit: 200,
  })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)
  vi.mocked(api.flipSingleLabelVerdict).mockResolvedValue({
    chatlog_id: 100,
    message_index: 4,
    text: '',
    confidence: 0.63,
    verdict: 'yes',
    applied_by: 'human',
    flagged: false,
    has_note: false,
    notebook: null,
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /keep yes/i }))

  await waitFor(() => {
    expect(api.flipSingleLabelVerdict).toHaveBeenCalledWith(detail.id, 100, 4, 'yes')
  })
  await waitFor(() => expect(screen.getByText(/2 of 2 to review/)).toBeInTheDocument())
})

test('Skip advances cursor without writing', async () => {
  const items: MessageListItem[] = [
    { ...item1, chatlog_id: 100, message_index: 4 },
    { ...item1, chatlog_id: 101, message_index: 2 },
  ]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({
    items,
    total: items.length,
    offset: 0,
    limit: 200,
  })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /skip/i }))

  await waitFor(() => expect(screen.getByText(/2 of 2/)).toBeInTheDocument())
  expect(api.flipSingleLabelVerdict).not.toHaveBeenCalled()
})

test('Undo after a flip restores the previous verdict on the server and steps back', async () => {
  const items: MessageListItem[] = [
    { ...item1, chatlog_id: 100, message_index: 4 },
    { ...item1, chatlog_id: 101, message_index: 2 },
  ]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({
    items,
    total: items.length,
    offset: 0,
    limit: 200,
  })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)
  vi.mocked(api.flipSingleLabelVerdict).mockResolvedValue({
    chatlog_id: 100,
    message_index: 4,
    text: '',
    confidence: 0.63,
    verdict: 'no',
    applied_by: 'human',
    flagged: false,
    has_note: false,
    notebook: null,
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  // Flip first hit no, advances to second
  fireEvent.click(screen.getByRole('button', { name: /flip to no/i }))
  await waitFor(() => expect(screen.getByText(/2 of 2/)).toBeInTheDocument())

  // Undo: should step back AND PATCH the previous verdict back to 'yes'
  fireEvent.click(screen.getByRole('button', { name: /undo/i }))
  await waitFor(() => expect(screen.getByText(/1 of 2/)).toBeInTheDocument())
  expect(api.flipSingleLabelVerdict).toHaveBeenLastCalledWith(detail.id, 100, 4, 'yes')
})

test('clicking "Flip to NO" (AI=yes) calls flipSingleLabelVerdict("no") and advances', async () => {
  const items: MessageListItem[] = [
    { ...item1, chatlog_id: 100, message_index: 4 },
    { ...item1, chatlog_id: 101, message_index: 2 },
  ]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({
    items,
    total: items.length,
    offset: 0,
    limit: 200,
  })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)
  vi.mocked(api.flipSingleLabelVerdict).mockResolvedValue({
    chatlog_id: 100,
    message_index: 4,
    text: '',
    confidence: 0.63,
    verdict: 'no',
    applied_by: 'human',
    flagged: false,
    has_note: false,
    notebook: null,
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  fireEvent.click(screen.getByRole('button', { name: /flip to no/i }))

  await waitFor(() => {
    expect(api.flipSingleLabelVerdict).toHaveBeenCalledWith(detail.id, 100, 4, 'no')
  })
})

test('keyboard "n" flips to no on focused hit', async () => {
  const items: MessageListItem[] = [{ ...item1, chatlog_id: 100, message_index: 4 }]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({
    items,
    total: 1,
    offset: 0,
    limit: 200,
  })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)
  vi.mocked(api.flipSingleLabelVerdict).mockResolvedValue({
    chatlog_id: 100,
    message_index: 4,
    text: '',
    confidence: 0.63,
    verdict: 'no',
    applied_by: 'human',
    flagged: false,
    has_note: false,
    notebook: null,
  })

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  fireEvent.keyDown(window, { key: 'n' })
  await waitFor(() =>
    expect(api.flipSingleLabelVerdict).toHaveBeenLastCalledWith(detail.id, 100, 4, 'no'),
  )
})

test('prefetches next page when cursor approaches end of current page', async () => {
  const page1: MessageListItem[] = Array.from({ length: 10 }, (_, i) => ({
    ...item1,
    chatlog_id: 100 + i,
    message_index: 0,
  }))
  const page2: MessageListItem[] = Array.from({ length: 5 }, (_, i) => ({
    ...item1,
    chatlog_id: 200 + i,
    message_index: 0,
  }))
  vi.mocked(api.listSingleLabelMessages)
    .mockResolvedValueOnce({ items: page1, total: 15, offset: 0, limit: 10 })
    .mockResolvedValueOnce({ items: page2, total: 15, offset: 10, limit: 10 })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)

  render(<TriageTab label={detail} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  // Advance to cursor 6 (within 5 of page end) to trigger prefetch
  for (let i = 0; i < 6; i++) {
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
  }

  await waitFor(() => expect(api.listSingleLabelMessages).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.getByText(/of 15/)).toBeInTheDocument())
})

test('keyboard listener ignores keypresses when focus is in an input', async () => {
  const items: MessageListItem[] = [{ ...item1, chatlog_id: 100, message_index: 4 }]
  vi.mocked(api.listSingleLabelMessages).mockResolvedValue({
    items,
    total: 1,
    offset: 0,
    limit: 200,
  })
  vi.mocked(api.getSingleLabelMessageDetail).mockResolvedValue(focused1)

  render(
    <div>
      <input data-testid="other-input" />
      <TriageTab label={detail} onLabelChanged={vi.fn()} />
    </div>,
  )
  await waitFor(() => expect(screen.getByText(/the mean is 4.2/)).toBeInTheDocument())

  const input = screen.getByTestId('other-input') as HTMLInputElement
  input.focus()
  fireEvent.keyDown(input, { key: 'y' })

  expect(api.flipSingleLabelVerdict).not.toHaveBeenCalled()
})
