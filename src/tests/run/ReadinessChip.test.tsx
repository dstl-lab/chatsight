import { render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ReadinessChip } from '../../components/run/ReadinessChip'
import type { ReadinessState } from '../../types'

const readiness: ReadinessState = {
  tier: 'amber',
  yes_count: 2,
  no_count: 1,
  skip_count: 0,
  conversations_walked: 2,
  total_conversations: 10,
  hint: 'Walk 3 more conversations for a green tier.',
}

describe('ReadinessChip', () => {
  test('controlled open shows the handoff panel', () => {
    render(
      <ReadinessChip
        readiness={readiness}
        onHandoff={vi.fn()}
        open
        onOpenChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/Hand off to Gemini/i)).toBeInTheDocument()
    expect(screen.getByText(/Walk 3 more conversations/i)).toBeInTheDocument()
  })
})
