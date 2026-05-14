import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { VerdictBlock } from '../../components/summaries/VerdictBlock'

test('renders verdict badge, pattern, and action buttons', () => {
  render(
    <VerdictBlock
      verdict="yes" confidence={0.58} appliedBy="ai"
      matchedPattern="questioning own work" rationale="Student misread the prompt."
      nearThreshold
      onAccept={vi.fn()} onFlip={vi.fn()} onFlag={vi.fn()}
    />
  )
  expect(screen.getByText('YES')).toBeInTheDocument()
  expect(screen.getByText(/questioning own work/)).toBeInTheDocument()
  expect(screen.getByText(/✓ accept/i)).toBeInTheDocument()
  expect(screen.getByText(/↺ flip/i)).toBeInTheDocument()
  expect(screen.getByText(/⚑ flag/i)).toBeInTheDocument()
})

test('rationale is hidden by default and shown when "why" is clicked', () => {
  render(
    <VerdictBlock
      verdict="yes" confidence={0.58} appliedBy="ai"
      matchedPattern="x" rationale="this is the rationale"
      nearThreshold={false}
      onAccept={vi.fn()} onFlip={vi.fn()} onFlag={vi.fn()}
    />
  )
  expect(screen.queryByText(/this is the rationale/)).not.toBeInTheDocument()
  fireEvent.click(screen.getByText(/why/i))
  expect(screen.getByText(/this is the rationale/)).toBeInTheDocument()
})

test('flip button calls onFlip with the opposite verdict', () => {
  const onFlip = vi.fn()
  render(
    <VerdictBlock
      verdict="yes" confidence={0.58} appliedBy="ai"
      matchedPattern={null} rationale={null}
      nearThreshold={false}
      onAccept={vi.fn()} onFlip={onFlip} onFlag={vi.fn()}
    />
  )
  fireEvent.click(screen.getByText(/flip/i))
  expect(onFlip).toHaveBeenCalledWith('no')
})

test('accept button calls onAccept', () => {
  const onAccept = vi.fn()
  render(
    <VerdictBlock
      verdict="no" confidence={0.1} appliedBy="ai"
      matchedPattern={null} rationale={null}
      nearThreshold={false}
      onAccept={onAccept} onFlip={vi.fn()} onFlag={vi.fn()}
    />
  )
  fireEvent.click(screen.getByText(/accept/i))
  expect(onAccept).toHaveBeenCalled()
})
