import { render, screen, fireEvent } from '@testing-library/react'
import { vi, beforeEach } from 'vitest'
import { DecisionWorkspace } from '../../components/decision/DecisionWorkspace'
import type { ConversationTurn } from '../../types'

const thread: ConversationTurn[] = [
  { message_index: 0, role: 'student', text: 'student question' },
]

// ── Layout tests ──────────────────────────────────────────────────────────────

test('renders header, dock, and ThreadView region', () => {
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      header={<div data-testid="header" />}
      dock={<div data-testid="dock" />}
    />,
  )
  expect(screen.getByTestId('header')).toBeInTheDocument()
  expect(screen.getByTestId('dock')).toBeInTheDocument()
  expect(screen.getByText('student question')).toBeInTheDocument()
})

test('omits header region when header prop not provided', () => {
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div data-testid="dock" />}
    />,
  )
  expect(screen.getByTestId('dock')).toBeInTheDocument()
})

test('renders flank in right column when provided', () => {
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div data-testid="dock" />}
      flank={<aside data-testid="flank" />}
    />,
  )
  expect(screen.getByTestId('flank')).toBeInTheDocument()
})

test('body grid uses 1-col layout when no flank', () => {
  const { container } = render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div data-testid="dock" />}
    />,
  )
  const body = container.querySelector('[data-region="body"]')
  expect(body?.className).toMatch(/grid-cols-\[1fr\]/)
})

test('body grid uses 2-col layout when flank is present', () => {
  const { container } = render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div data-testid="dock" />}
      flank={<aside />}
    />,
  )
  const body = container.querySelector('[data-region="body"]')
  expect(body?.className).toMatch(/grid-cols-\[1fr_320px\]/)
})

test('renders emptyState in place of ThreadView when thread is empty', () => {
  render(
    <DecisionWorkspace
      thread={[]}
      focusIndex={0}
      dock={<div data-testid="dock" />}
      emptyState={<div data-testid="empty">Nothing here</div>}
    />,
  )
  expect(screen.getByTestId('empty')).toBeInTheDocument()
  expect(screen.getByTestId('dock')).toBeInTheDocument()
})

test('body region has min-h-0 and overflow-hidden classes (scroll contract)', () => {
  const { container } = render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div />}
    />,
  )
  const body = container.querySelector('[data-region="body"]')
  expect(body?.className).toMatch(/min-h-0/)
  expect(body?.className).toMatch(/overflow-hidden/)
})

// ── Keyboard tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
})

test('pressing "y" fires onYes', () => {
  const onYes = vi.fn()
  render(
    <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />,
  )
  fireEvent.keyDown(window, { key: 'y' })
  expect(onYes).toHaveBeenCalledTimes(1)
})

test('pressing "Y" (uppercase) also fires onYes', () => {
  const onYes = vi.fn()
  render(
    <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />,
  )
  fireEvent.keyDown(window, { key: 'Y' })
  expect(onYes).toHaveBeenCalledTimes(1)
})

test('pressing "n", "s", "z", "Enter" fires the matching handlers', () => {
  const onNo = vi.fn()
  const onSkip = vi.fn()
  const onUndo = vi.fn()
  const onAcceptAi = vi.fn()
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div />}
      onNo={onNo}
      onSkip={onSkip}
      onUndo={onUndo}
      onAcceptAi={onAcceptAi}
    />,
  )
  fireEvent.keyDown(window, { key: 'n' })
  fireEvent.keyDown(window, { key: 's' })
  fireEvent.keyDown(window, { key: 'z' })
  fireEvent.keyDown(window, { key: 'Enter' })
  expect(onNo).toHaveBeenCalledTimes(1)
  expect(onSkip).toHaveBeenCalledTimes(1)
  expect(onUndo).toHaveBeenCalledTimes(1)
  expect(onAcceptAi).toHaveBeenCalledTimes(1)
})

test('omitted handlers are silently ignored (no throw)', () => {
  render(<DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} />)
  expect(() => fireEvent.keyDown(window, { key: 'y' })).not.toThrow()
})

test('keyboard handlers suppressed when focus is in an input', () => {
  const onYes = vi.fn()
  render(
    <>
      <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />
      <input data-testid="probe" />
    </>,
  )
  const input = screen.getByTestId('probe')
  input.focus()
  fireEvent.keyDown(window, { key: 'y' })
  expect(onYes).not.toHaveBeenCalled()
})

test('keyboard handlers suppressed when focus is in a textarea', () => {
  const onYes = vi.fn()
  render(
    <>
      <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />
      <textarea data-testid="probe" />
    </>,
  )
  const ta = screen.getByTestId('probe')
  ta.focus()
  fireEvent.keyDown(window, { key: 'y' })
  expect(onYes).not.toHaveBeenCalled()
})

test('non-mapped keys are ignored and not preventDefault', () => {
  const onYes = vi.fn()
  render(
    <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />,
  )
  const e = new KeyboardEvent('keydown', { key: 'q', cancelable: true })
  window.dispatchEvent(e)
  expect(onYes).not.toHaveBeenCalled()
  expect(e.defaultPrevented).toBe(false)
})

test('keyboard handler is removed on unmount', () => {
  const onYes = vi.fn()
  const { unmount } = render(
    <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />,
  )
  unmount()
  fireEvent.keyDown(window, { key: 'y' })
  expect(onYes).not.toHaveBeenCalled()
})

test('keyboard handlers suppressed when focus is in a contenteditable element', () => {
  const onYes = vi.fn()
  render(
    <>
      <DecisionWorkspace thread={thread} focusIndex={0} dock={<div />} onYes={onYes} />
      <div data-testid="probe" contentEditable suppressContentEditableWarning />
    </>,
  )
  const ed = screen.getByTestId('probe')
  ed.focus()
  fireEvent.keyDown(window, { key: 'y' })
  expect(onYes).not.toHaveBeenCalled()
})

test('keyboard handlers suppressed when disabled is true', () => {
  const onYes = vi.fn()
  const onSkip = vi.fn()
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div />}
      onYes={onYes}
      onSkip={onSkip}
      disabled
    />,
  )
  fireEvent.keyDown(window, { key: 'y' })
  fireEvent.keyDown(window, { key: 's' })
  expect(onYes).not.toHaveBeenCalled()
  expect(onSkip).not.toHaveBeenCalled()
})

test('keyboard handlers ignore key events with modifier keys', () => {
  const onYes = vi.fn()
  const onSkip = vi.fn()
  render(
    <DecisionWorkspace
      thread={thread}
      focusIndex={0}
      dock={<div />}
      onYes={onYes}
      onSkip={onSkip}
    />,
  )
  fireEvent.keyDown(window, { key: 'y', shiftKey: true })
  fireEvent.keyDown(window, { key: 's', shiftKey: true })
  fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
  fireEvent.keyDown(window, { key: 'Enter', metaKey: true })
  expect(onYes).not.toHaveBeenCalled()
  expect(onSkip).not.toHaveBeenCalled()
})
