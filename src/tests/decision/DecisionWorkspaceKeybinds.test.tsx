import { render, fireEvent, createEvent } from '@testing-library/react'
import { vi, describe, it, expect } from 'vitest'
import { DecisionWorkspace } from '../../components/decision/DecisionWorkspace'
import { KeybindProvider } from '../../hooks/useKeybinds'
import type { ConversationTurn } from '../../types'

const mockThread: ConversationTurn[] = [
  { message_index: 0, role: 'student', text: 'Hello' }
]

const renderWorkspace = (props = {}) => {
  return render(
    <KeybindProvider>
      <DecisionWorkspace
        thread={mockThread}
        focusIndex={0}
        dock={<div>Dock</div>}
        {...props}
      />
    </KeybindProvider>
  )
}

describe('DecisionWorkspace Keybinds', () => {
  it('calls onYes when "a" is pressed (default)', () => {
    const onYes = vi.fn()
    renderWorkspace({ onYes })
    fireEvent.keyDown(window, { key: 'a' })
    expect(onYes).toHaveBeenCalled()
  })

  it('calls onNo when "d" is pressed (default)', () => {
    const onNo = vi.fn()
    renderWorkspace({ onNo })
    fireEvent.keyDown(window, { key: 'd' })
    expect(onNo).toHaveBeenCalled()
  })

  it('calls onSkip when " " (Space) is pressed (default)', () => {
    const onSkip = vi.fn()
    renderWorkspace({ onSkip })
    fireEvent.keyDown(window, { key: ' ' })
    expect(onSkip).toHaveBeenCalled()
  })

  it('calls onUndo when "s" is pressed (default)', () => {
    const onUndo = vi.fn()
    renderWorkspace({ onUndo })
    fireEvent.keyDown(window, { key: 's' })
    expect(onUndo).toHaveBeenCalled()
  })

  it('prevents default behavior when Space is pressed', () => {
    const onSkip = vi.fn()
    renderWorkspace({ onSkip })
    const event = createEvent.keyDown(window, { key: ' ' })
    vi.spyOn(event, 'preventDefault')
    fireEvent(window, event)
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('respects case-insensitivity', () => {
    const onYes = vi.fn()
    renderWorkspace({ onYes })
    fireEvent.keyDown(window, { key: 'A' })
    expect(onYes).toHaveBeenCalled()
  })
})
