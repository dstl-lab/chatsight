import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { AssistFlank } from '../components/run/AssistFlank'
import type { AssistNeighbor } from '../types'

const NEIGHBORS: AssistNeighbor[] = [
  { chatlog_id: 1, message_index: 0, value: 'yes', similarity: 0.84,
    message_text: "i'm stuck on q3" },
  { chatlog_id: 2, message_index: 0, value: 'no', similarity: 0.71,
    message_text: 'why does numpy default to n' },
]

describe('AssistFlank', () => {
  it('renders the empty state when neighbors is empty', () => {
    render(<AssistFlank neighbors={[]} />)
    expect(screen.getByText(/will appear here as you label/i)).toBeInTheDocument()
    // Header shouldn't appear in the empty state. Use exact-string match
    // (lowercase) so the empty-state paragraph "Your closest prior decisions
    // will appear here as you label." doesn't collide.
    expect(screen.queryByText('your closest prior decisions')).toBeNull()
  })

  it('renders the header and one entry per neighbor', () => {
    render(<AssistFlank neighbors={NEIGHBORS} />)
    expect(screen.getByText('your closest prior decisions')).toBeInTheDocument()
    expect(screen.getByText(/i'm stuck on q3/)).toBeInTheDocument()
    expect(screen.getByText(/why does numpy default to n/)).toBeInTheDocument()
    // Verdict text is uppercase YES / NO from CSS, but the underlying text reads "yes"/"no"
    expect(screen.getAllByText('yes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('no').length).toBeGreaterThan(0)
    // One row per neighbor — guards against a duplicate-key bug rendering extra rows.
    expect(screen.getAllByTestId('neighbor-row').length).toBe(NEIGHBORS.length)
  })

  it('renders similarity scores', () => {
    render(<AssistFlank neighbors={NEIGHBORS} />)
    expect(screen.getByText(/sim 0.84/)).toBeInTheDocument()
    expect(screen.getByText(/sim 0.71/)).toBeInTheDocument()
  })
})
