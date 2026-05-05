// src/tests/Navigation.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
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
