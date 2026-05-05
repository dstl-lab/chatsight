import { render, screen, fireEvent } from '@testing-library/react'
import { ModeProvider, useMode } from '../hooks/useMode'

function ModeProbe() {
  const { mode, setMode } = useMode()
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button onClick={() => setMode(mode === 'multi' ? 'single' : 'multi')}>toggle</button>
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
})

test('defaults to multi-label mode', () => {
  render(
    <ModeProvider>
      <ModeProbe />
    </ModeProvider>
  )
  expect(screen.getByTestId('mode').textContent).toBe('multi')
})

test('persists mode to localStorage', () => {
  render(
    <ModeProvider>
      <ModeProbe />
    </ModeProvider>
  )
  fireEvent.click(screen.getByText('toggle'))
  expect(screen.getByTestId('mode').textContent).toBe('single')
  expect(localStorage.getItem('chatsight-mode')).toBe('single')
})

test('reads initial mode from localStorage', () => {
  localStorage.setItem('chatsight-mode', 'single')
  render(
    <ModeProvider>
      <ModeProbe />
    </ModeProvider>
  )
  expect(screen.getByTestId('mode').textContent).toBe('single')
})
