import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { DockButton } from '../../components/decision/DockButton'

test('renders label and kbd chip', () => {
  render(<DockButton label="Keep YES" kbd="y" tone="primary" onClick={vi.fn()} />)
  expect(screen.getByRole('button', { name: /keep yes/i })).toBeInTheDocument()
  expect(screen.getByText('y')).toBeInTheDocument()
})

test('clicking fires onClick', () => {
  const onClick = vi.fn()
  render(<DockButton label="Skip" kbd="s" tone="muted" onClick={onClick} />)
  fireEvent.click(screen.getByRole('button', { name: /skip/i }))
  expect(onClick).toHaveBeenCalledTimes(1)
})

test('disabled prevents onClick', () => {
  const onClick = vi.fn()
  render(<DockButton label="Undo" kbd="z" tone="muted" onClick={onClick} disabled />)
  fireEvent.click(screen.getByRole('button', { name: /undo/i }))
  expect(onClick).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled()
})

test('applies tone-specific border class for each tone', () => {
  const tones: Array<{ tone: 'primary' | 'moss' | 'brick' | 'muted'; expectedClass: string }> = [
    { tone: 'primary', expectedClass: 'border-ochre' },
    { tone: 'moss', expectedClass: 'border-moss' },
    { tone: 'brick', expectedClass: 'border-brick' },
    { tone: 'muted', expectedClass: 'border-edge' },
  ]
  for (const { tone, expectedClass } of tones) {
    const { unmount } = render(<DockButton label="X" kbd="x" tone={tone} onClick={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveClass(expectedClass)
    unmount()
  }
})
