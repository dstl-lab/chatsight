import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach } from 'vitest'
import { AiReviewDock } from '../../components/decision/AiReviewDock'

beforeEach(() => {
  vi.clearAllMocks()
})

const triageProps = {
  mode: { kind: 'triage' as const, aiVerdict: 'yes' as const },
  onYes: vi.fn(),
  onNo: vi.fn(),
  onSkip: vi.fn(),
  onUndo: vi.fn(),
  onAcceptAi: vi.fn(),
  canUndo: true,
  disabled: false,
}

test('triage variant with aiVerdict=yes labels primary "Keep YES", secondary "Flip to NO"', () => {
  render(<AiReviewDock {...triageProps} />)
  expect(screen.getByRole('button', { name: /keep yes/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeInTheDocument()
})

test('triage variant with aiVerdict=no reverses labels', () => {
  render(<AiReviewDock {...triageProps} mode={{ kind: 'triage', aiVerdict: 'no' }} />)
  expect(screen.getByRole('button', { name: /flip to yes/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /keep no/i })).toBeInTheDocument()
})

test('triage variant renders Undo and Accept-AI affordances', () => {
  render(<AiReviewDock {...triageProps} />)
  expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /accept ai/i })).toBeInTheDocument()
})

test('triage variant disables Undo when canUndo=false', () => {
  render(<AiReviewDock {...triageProps} canUndo={false} />)
  expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled()
})

test('triage variant: clicking Accept-AI fires onAcceptAi', () => {
  const onAcceptAi = vi.fn()
  render(<AiReviewDock {...triageProps} onAcceptAi={onAcceptAi} />)
  fireEvent.click(screen.getByRole('button', { name: /accept ai/i }))
  expect(onAcceptAi).toHaveBeenCalledTimes(1)
})

test('triage variant: clicking Keep YES fires onYes', () => {
  const onYes = vi.fn()
  render(<AiReviewDock {...triageProps} onYes={onYes} />)
  fireEvent.click(screen.getByRole('button', { name: /keep yes/i }))
  expect(onYes).toHaveBeenCalledTimes(1)
})

test('triage variant: disabled=true disables all decision buttons', () => {
  render(<AiReviewDock {...triageProps} disabled />)
  expect(screen.getByRole('button', { name: /keep yes/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled()
})

const reviewProps = {
  mode: {
    kind: 'review' as const,
    aiValue: 'yes' as const,
    aiConfidence: 0.87,
    position: 3,
    total: 12,
  },
  onYes: vi.fn(),
  onNo: vi.fn(),
  onSkip: vi.fn(),
  disabled: false,
}

test('review variant with aiValue=yes shows "Confirm Yes" and "Flip to No"', () => {
  render(<AiReviewDock {...reviewProps} />)
  expect(screen.getByRole('button', { name: /confirm yes/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeInTheDocument()
})

test('review variant with aiValue=no reverses labels', () => {
  render(
    <AiReviewDock
      {...reviewProps}
      mode={{ ...reviewProps.mode, aiValue: 'no' }}
    />,
  )
  expect(screen.getByRole('button', { name: /confirm no/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /flip to yes/i })).toBeInTheDocument()
})

test('review variant renders position/total + confidence summary', () => {
  render(<AiReviewDock {...reviewProps} />)
  expect(screen.getByText(/reviewing AI prediction 3 of 12/i)).toBeInTheDocument()
  expect(screen.getByText(/confidence 0\.87/)).toBeInTheDocument()
})

test('review variant: clicking "Confirm Yes" fires onYes', () => {
  const onYes = vi.fn()
  render(<AiReviewDock {...reviewProps} onYes={onYes} />)
  fireEvent.click(screen.getByRole('button', { name: /confirm yes/i }))
  expect(onYes).toHaveBeenCalledTimes(1)
})

test('review variant: clicking "Flip to No" fires onNo', () => {
  const onNo = vi.fn()
  render(<AiReviewDock {...reviewProps} onNo={onNo} />)
  fireEvent.click(screen.getByRole('button', { name: /flip to no/i }))
  expect(onNo).toHaveBeenCalledTimes(1)
})

test('review variant: disabled=true disables all buttons', () => {
  render(<AiReviewDock {...reviewProps} disabled />)
  expect(screen.getByRole('button', { name: /confirm yes/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /flip to no/i })).toBeDisabled()
  expect(screen.getByRole('button', { name: /skip/i })).toBeDisabled()
})

test('review variant does NOT render Undo or Accept-AI affordances', () => {
  render(<AiReviewDock {...reviewProps} />)
  expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /accept ai/i })).not.toBeInTheDocument()
})

test('triage variant: clicking Skip fires onSkip', () => {
  const onSkip = vi.fn()
  render(<AiReviewDock {...triageProps} onSkip={onSkip} />)
  fireEvent.click(screen.getByRole('button', { name: /skip/i }))
  expect(onSkip).toHaveBeenCalledTimes(1)
})

test('triage variant without onUndo hides the Undo button', () => {
  // Construct props without onUndo. We re-spread triageProps and override only onUndo to undefined.
  const { onUndo: _omit, ...rest } = triageProps
  render(<AiReviewDock {...rest} />)
  expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
})

test('triage variant without onAcceptAi hides the Accept-AI button', () => {
  const { onAcceptAi: _omit, ...rest } = triageProps
  render(<AiReviewDock {...rest} />)
  expect(screen.queryByRole('button', { name: /accept ai/i })).not.toBeInTheDocument()
})
