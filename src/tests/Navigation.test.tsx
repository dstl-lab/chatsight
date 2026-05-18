// src/tests/Navigation.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { Navigation } from '../components/Navigation'
import { ModeProvider } from '../hooks/useMode'

function renderNav() {
  return render(
    <ModeProvider>
      <MemoryRouter>
        <Navigation />
      </MemoryRouter>
    </ModeProvider>
  )
}

function LocationProbe() {
  const loc = useLocation()
  return <span data-testid="path">{loc.pathname}</span>
}

function renderNavWithLocation(initialPath = '/summaries') {
  return render(
    <ModeProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Navigation />
        <LocationProbe />
      </MemoryRouter>
    </ModeProvider>
  )
}

beforeEach(() => {
  localStorage.clear()
})

test('renders Queue, Labels, and Analysis links in multi-label mode (default)', () => {
  renderNav()
  expect(screen.getByText('Queue')).toBeInTheDocument()
  expect(screen.getByText('Labels')).toBeInTheDocument()
  expect(screen.getByText('Analysis')).toBeInTheDocument()
})

test('shows mode toggle button', () => {
  renderNav()
  // Default mode is "multi"; the toggle button has a title attribute reflecting the current mode.
  expect(screen.getByTitle(/Mode: Multi-label/)).toBeInTheDocument()
})

test('clicking mode toggle from multi navigates to /run (single landing)', () => {
  renderNavWithLocation('/summaries')
  expect(screen.getByTestId('path').textContent).toBe('/summaries')
  fireEvent.click(screen.getByTitle(/Mode: Multi-label/))
  expect(screen.getByTestId('path').textContent).toBe('/run')
})

test('clicking mode toggle from single navigates to /queue (multi landing)', () => {
  localStorage.setItem('chatsight-mode', 'single')
  renderNavWithLocation('/summaries')
  expect(screen.getByTestId('path').textContent).toBe('/summaries')
  fireEvent.click(screen.getByTitle(/Mode: Single-label/))
  expect(screen.getByTestId('path').textContent).toBe('/queue')
})
