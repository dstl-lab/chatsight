// src/tests/Navigation.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Navigation } from '../components/Navigation'

test('renders Queue, Labels, and Analysis links', () => {
  render(<MemoryRouter><Navigation /></MemoryRouter>)
  expect(screen.getByText('Queue')).toBeInTheDocument()
  expect(screen.getByText('Labels')).toBeInTheDocument()
  expect(screen.getByText('Analysis')).toBeInTheDocument()
})
