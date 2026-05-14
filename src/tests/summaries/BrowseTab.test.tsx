import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { BrowseTab } from '../../components/summaries/BrowseTab'
import type { SingleLabelDetail, MessageListResponse, MessageDetail } from '../../types'

const label: SingleLabelDetail = {
  id: 1, name: 'self-correction', description: null, phase: 'handed_off',
  yes_count: 2, no_count: 1, review_count: 0, review_threshold: 0.7,
  agreement_vs_gold: null, confidence_histogram: [],
}

const list: MessageListResponse = {
  items: [
    { chatlog_id: 1, message_index: 0, text: 'first message', confidence: 0.5,
      verdict: 'yes', applied_by: 'ai', flagged: false, has_note: false, notebook: null },
    { chatlog_id: 2, message_index: 0, text: 'second message', confidence: 0.8,
      verdict: 'yes', applied_by: 'ai', flagged: false, has_note: false, notebook: null },
  ],
  total: 2, offset: 0, limit: 200,
}

const msgDetail: MessageDetail = {
  chatlog_id: 1, message_index: 0, text: 'first message',
  confidence: 0.5, verdict: 'yes', applied_by: 'ai',
  matched_pattern: 'pattern', rationale: 'rationale',
  flagged: false, note: null,
  context_before: [], context_after: [],
  notebook: null, turn_index: 0, total_turns: 1,
}

const { mockListMessages, mockGetDetail, mockFlip, mockUpsertNote } = vi.hoisted(() => ({
  mockListMessages: vi.fn(),
  mockGetDetail: vi.fn(),
  mockFlip: vi.fn(),
  mockUpsertNote: vi.fn(),
}))

vi.mock('../../services/api', () => ({
  api: {
    listSingleLabelMessages: mockListMessages,
    getSingleLabelMessageDetail: mockGetDetail,
    flipSingleLabelVerdict: mockFlip,
    upsertSingleLabelNote: mockUpsertNote,
  },
}))

beforeEach(() => {
  mockListMessages.mockResolvedValue(list)
  mockGetDetail.mockResolvedValue(msgDetail)
  mockFlip.mockResolvedValue({ ...list.items[0], verdict: 'no', applied_by: 'human' })
  mockUpsertNote.mockResolvedValue({ ok: true })
})

test('renders messages then loads detail on click', async () => {
  render(<BrowseTab label={label} onLabelChanged={vi.fn()} />)
  await waitFor(() => expect(screen.getByText('first message')).toBeInTheDocument())
  fireEvent.click(screen.getByText('first message'))
  await waitFor(() => expect(screen.getByText('YES')).toBeInTheDocument())
})

test('flip is optimistic and rolls back on failure', async () => {
  mockFlip.mockRejectedValueOnce(new Error('boom'))
  const onChanged = vi.fn()
  render(<BrowseTab label={label} onLabelChanged={onChanged} />)
  await waitFor(() => expect(screen.getByText('first message')).toBeInTheDocument())
  fireEvent.click(screen.getByText('first message'))
  await waitFor(() => expect(screen.getByText('YES')).toBeInTheDocument())
  fireEvent.click(screen.getByText('↺ flip'))
  // After failure, the verdict reverts to YES (still rendered)
  await waitFor(() => expect(screen.getByText('YES')).toBeInTheDocument())
  expect(onChanged).not.toHaveBeenCalled()
})
