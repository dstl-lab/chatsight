import { render, screen, fireEvent } from '@testing-library/react'
import { ConversationContext } from '../../components/summaries/ConversationContext'
import type { SummariesConversationTurn } from '../../types'

const before: SummariesConversationTurn[] = [{ role: 'tutor', turn_index: 5, text: 'try aggfunc=median' }]
const after: SummariesConversationTurn[] = [{ role: 'tutor', turn_index: 7, text: 'great — re-run' }]

test('renders collapsed before and after bars + the focused message visibly', () => {
  render(
    <ConversationContext
      before={before}
      after={after}
      focusedText="wait, I misread"
      focusedTurnIndex={6}
      totalTurns={11}
    />,
  )
  expect(screen.getByText(/tutor turn before/i)).toBeInTheDocument()
  expect(screen.getByText(/tutor turn after/i)).toBeInTheDocument()
  expect(screen.getByText(/wait, I misread/)).toBeInTheDocument()
  expect(screen.queryByText(/try aggfunc/)).not.toBeInTheDocument()
})

test('clicking the before bar expands it to show the turn text', () => {
  render(
    <ConversationContext
      before={before}
      after={after}
      focusedText="wait, I misread"
      focusedTurnIndex={6}
      totalTurns={11}
    />,
  )
  fireEvent.click(screen.getByText(/tutor turn before/i))
  expect(screen.getByText(/try aggfunc/)).toBeInTheDocument()
})

test('hides before bar when no before turns', () => {
  render(
    <ConversationContext
      before={[]}
      after={after}
      focusedText="..."
      focusedTurnIndex={0}
      totalTurns={2}
    />,
  )
  expect(screen.queryByText(/tutor turn before/i)).not.toBeInTheDocument()
  expect(screen.getByText(/tutor turn after/i)).toBeInTheDocument()
})
