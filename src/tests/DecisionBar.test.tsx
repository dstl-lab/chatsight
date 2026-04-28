import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DecisionBar } from '../components/run/DecisionBar'

describe('DecisionBar', () => {
  it('calls onDecide with yes/no/skip on button click', () => {
    const onDecide = vi.fn()
    render(<DecisionBar onDecide={onDecide} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    fireEvent.click(screen.getByRole('button', { name: /no/i }))
    fireEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(onDecide).toHaveBeenNthCalledWith(1, 'yes')
    expect(onDecide).toHaveBeenNthCalledWith(2, 'no')
    expect(onDecide).toHaveBeenNthCalledWith(3, 'skip')
  })

  it('responds to keyboard shortcuts y/n/s', () => {
    const onDecide = vi.fn()
    render(<DecisionBar onDecide={onDecide} disabled={false} />)
    fireEvent.keyDown(window, { key: 'y' })
    fireEvent.keyDown(window, { key: 'n' })
    fireEvent.keyDown(window, { key: 's' })
    expect(onDecide).toHaveBeenCalledWith('yes')
    expect(onDecide).toHaveBeenCalledWith('no')
    expect(onDecide).toHaveBeenCalledWith('skip')
    expect(onDecide).toHaveBeenCalledTimes(3)
  })

  it('does not call onDecide when disabled', () => {
    const onDecide = vi.fn()
    render(<DecisionBar onDecide={onDecide} disabled={true} />)
    fireEvent.click(screen.getByRole('button', { name: /yes/i }))
    fireEvent.keyDown(window, { key: 'y' })
    expect(onDecide).not.toHaveBeenCalled()
  })
})
