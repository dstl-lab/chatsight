import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { FilterBar } from '../../components/summaries/FilterBar'

test('renders four essential chips plus "+ more"', () => {
  render(<FilterBar bucket="all" sort="confidence_asc" search="" onChange={vi.fn()} />)
  expect(screen.getByText('All')).toBeInTheDocument()
  expect(screen.getByText('YES')).toBeInTheDocument()
  expect(screen.getByText('NO')).toBeInTheDocument()
  expect(screen.getByText('Review')).toBeInTheDocument()
  expect(screen.getByText(/\+ more/i)).toBeInTheDocument()
})

test('clicking YES chip emits onChange with bucket=yes', () => {
  const onChange = vi.fn()
  render(<FilterBar bucket="all" sort="confidence_asc" search="" onChange={onChange} />)
  fireEvent.click(screen.getByText('YES'))
  expect(onChange).toHaveBeenCalledWith({ bucket: 'yes' })
})

test('search input emits onChange with new value', () => {
  const onChange = vi.fn()
  render(<FilterBar bucket="all" sort="confidence_asc" search="" onChange={onChange} />)
  fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'misread' } })
  expect(onChange).toHaveBeenCalledWith({ search: 'misread' })
})

test('sort select emits onChange with new value', () => {
  const onChange = vi.fn()
  render(<FilterBar bucket="all" sort="confidence_asc" search="" onChange={onChange} />)
  fireEvent.change(screen.getByDisplayValue(/conf\s*↑/i), { target: { value: 'confidence_desc' } })
  expect(onChange).toHaveBeenCalledWith({ sort: 'confidence_desc' })
})

test('active chip has visible active styling marker', () => {
  render(<FilterBar bucket="yes" sort="confidence_asc" search="" onChange={vi.fn()} />)
  // The active chip exposes data-active="true" for stable querying
  expect(screen.getByTestId('chip-yes')).toHaveAttribute('data-active', 'true')
  expect(screen.getByTestId('chip-all')).toHaveAttribute('data-active', 'false')
})
