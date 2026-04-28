import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

vi.mock('../services/api', async () => {
  const actual: any = await vi.importActual('../services/api')
  return {
    api: {
      ...actual.api,
      listBinaryLabels: vi.fn().mockResolvedValue([
        { id: 1, name: 'L', description: null, phase: 'labeling', is_active: true, yes_count: 0, no_count: 0, skip_count: 0, ai_count: 0 },
      ]),
      getBinaryNext: vi.fn().mockResolvedValue({
        chatlog_id: 5, message_index: 0,
        message_text: 'hi',
        context_before: null, context_after: null,
        conversation_context: [{ chatlog_id: 5, message_index: 0, message_text: 'hi', context_before: null, context_after: null }],
        done: false,
      }),
      decideBinary: vi.fn().mockResolvedValue({
        chatlog_id: null, message_index: null, message_text: null,
        context_before: null, context_after: null,
        conversation_context: [], done: true,
      }),
      getBinaryReadiness: vi.fn().mockResolvedValue({
        yes_count: 0, no_count: 0, skip_count: 0,
        conversations_walked: 0, total_conversations: 1, ready: false,
      }),
    },
  }
})

import { LabelRunPage } from '../pages/LabelRunPage'

describe('LabelRunPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads the active label and shows the focused message', async () => {
    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes><Route path="/run" element={<LabelRunPage />} /></Routes>
      </MemoryRouter>
    )
    await waitFor(() => expect(screen.getByText('hi')).toBeInTheDocument())
    expect(screen.getByText('L')).toBeInTheDocument()
  })

  it('records a decision and shows the done state', async () => {
    render(
      <MemoryRouter initialEntries={['/run']}>
        <Routes><Route path="/run" element={<LabelRunPage />} /></Routes>
      </MemoryRouter>
    )
    await waitFor(() => screen.getByText('hi'))
    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    await waitFor(() => expect(screen.getByText(/all caught up/i)).toBeInTheDocument())
  })
})
