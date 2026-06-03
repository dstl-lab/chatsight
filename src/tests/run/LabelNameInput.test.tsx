import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { LabelNameInput } from '../../components/run/LabelNameInput'
import type { LabelNameSuggestion } from '../../types'

const suggestions: LabelNameSuggestion[] = [
  { name: 'confusion', description: 'Student shows confusion about a concept' },
  { name: 'code help', description: 'Requesting help with code' },
]

describe('LabelNameInput', () => {
  it('shows filtered suggestions when focused and typing', () => {
    render(<LabelNameInput value="con" onChange={() => {}} suggestions={suggestions} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getByText('confusion')).toBeInTheDocument()
    expect(screen.queryByText('code help')).not.toBeInTheDocument()
  })

  it('hides dropdown when typed value exactly matches a suggestion', () => {
    render(<LabelNameInput value="confusion" onChange={() => {}} suggestions={suggestions} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('calls onChange and onCommit when suggestion is clicked', () => {
    const onChange = vi.fn()
    const onCommit = vi.fn()
    render(
      <LabelNameInput value="con" onChange={onChange} onCommit={onCommit} suggestions={suggestions} />
    )
    fireEvent.focus(screen.getByRole('combobox'))
    fireEvent.mouseDown(screen.getByText('confusion'))
    expect(onChange).toHaveBeenCalledWith('confusion')
    expect(onCommit).toHaveBeenCalled()
  })

  it('selects first suggestion on Enter when dropdown is open', () => {
    const onChange = vi.fn()
    render(<LabelNameInput value="con" onChange={onChange} suggestions={suggestions} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('confusion')
  })

  it('navigates to second suggestion with ArrowDown then selects with Enter', () => {
    const onChange = vi.fn()
    render(<LabelNameInput value="c" onChange={onChange} suggestions={suggestions} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('code help')
  })

  it('closes dropdown on Escape', () => {
    render(<LabelNameInput value="con" onChange={() => {}} suggestions={suggestions} />)
    const input = screen.getByRole('combobox')
    fireEvent.focus(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('passes unhandled keyDown events to the onKeyDown prop', () => {
    const onKeyDown = vi.fn()
    render(
      <LabelNameInput value="" onChange={() => {}} suggestions={[]} onKeyDown={onKeyDown} />
    )
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(onKeyDown).toHaveBeenCalled()
  })

  it('renders as a plain input when suggestions is empty', () => {
    render(<LabelNameInput value="any" onChange={() => {}} suggestions={[]} />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
