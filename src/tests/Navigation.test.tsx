// src/tests/Navigation.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Navigation } from '../components/Navigation'

test('renders Run, Labels, and Analysis links', () => {
  render(<MemoryRouter><Navigation /></MemoryRouter>)
  expect(screen.getByText('Run')).toBeInTheDocument()
  expect(screen.getByText('Labels')).toBeInTheDocument()
  expect(screen.getByText('Analysis')).toBeInTheDocument()
})
