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
  it('calls onYes when "z" is pressed (default)', () => {
    const onYes = vi.fn()
    renderWorkspace({ onYes })
    fireEvent.keyDown(window, { key: 'z' })
    expect(onYes).toHaveBeenCalled()
  })

  it('calls onNo when "d" is pressed (default)', () => {
    const onNo = vi.fn()
    renderWorkspace({ onNo })
    fireEvent.keyDown(window, { key: 'd' })
    expect(onNo).toHaveBeenCalled()
  })

  it('calls onSkip when ArrowRight is pressed (default)', () => {
    const onSkip = vi.fn()
    renderWorkspace({ onSkip })
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(onSkip).toHaveBeenCalled()
  })

  it('calls onSkip when Enter is pressed and no onAcceptAi handler', () => {
    const onSkip = vi.fn()
    renderWorkspace({ onSkip })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onSkip).toHaveBeenCalled()
  })

  it('calls onUndo when ArrowLeft is pressed (default)', () => {
    const onUndo = vi.fn()
    renderWorkspace({ onUndo })
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(onUndo).toHaveBeenCalled()
  })

  it('does not call onSkip on Enter when onAcceptAi is provided', () => {
    const onSkip = vi.fn()
    const onAcceptAi = vi.fn()
    renderWorkspace({ onSkip, onAcceptAi })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onAcceptAi).toHaveBeenCalled()
    expect(onSkip).not.toHaveBeenCalled()
  })

  it('respects case-insensitivity', () => {
    const onYes = vi.fn()
    renderWorkspace({ onYes })
    fireEvent.keyDown(window, { key: 'Z' })
    expect(onYes).toHaveBeenCalled()
  })

  describe('Shift Keybinds', () => {
    const STORAGE_KEY = 'chatsight-keybinds'

    it('calls onYes when Shift+Enter is pressed and bound to "shift+enter"', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ yes: 'shift+enter' }))
      const onYes = vi.fn()
      renderWorkspace({ onYes })
      fireEvent.keyDown(window, { key: 'Enter', shiftKey: true })
      expect(onYes).toHaveBeenCalled()
      localStorage.removeItem(STORAGE_KEY)
    })

    it('calls onAcceptAi when Shift+Enter is pressed even if NOT explicitly bound (backward compatibility)', () => {
      const onAcceptAi = vi.fn()
      renderWorkspace({ onAcceptAi })
      fireEvent.keyDown(window, { key: 'Enter', shiftKey: true })
      expect(onAcceptAi).toHaveBeenCalled()
    })

    it('ignores plain Enter if "yes" is bound to shift+enter', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ yes: 'shift+enter' }))
      const onYes = vi.fn()
      renderWorkspace({ onYes })
      fireEvent.keyDown(window, { key: 'Enter', shiftKey: false })
      expect(onYes).not.toHaveBeenCalled()
      localStorage.removeItem(STORAGE_KEY)
    })
  })
})
