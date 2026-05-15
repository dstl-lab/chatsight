import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { TriageFilterRow } from '../../components/summaries/TriageFilterRow'

test('renders review and all chips; flagged chip hidden when flaggedCount = 0', () => {
  render(
    <TriageFilterRow
      filter="review"
      sort="confidence_asc"
      reviewCount={47}
      flaggedCount={0}
      onFilterChange={vi.fn()}
      onSortChange={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /^all$/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /flagged/i })).not.toBeInTheDocument()
})

test('flagged chip appears when flaggedCount > 0', () => {
  render(
    <TriageFilterRow
      filter="review"
      sort="confidence_asc"
      reviewCount={47}
      flaggedCount={3}
      onFilterChange={vi.fn()}
      onSortChange={vi.fn()}
    />,
  )
  expect(screen.getByRole('button', { name: /flagged \(3\)/i })).toBeInTheDocument()
})

test('clicking a chip fires onFilterChange with that value', () => {
  const onFilterChange = vi.fn()
  render(
    <TriageFilterRow
      filter="review"
      sort="confidence_asc"
      reviewCount={47}
      flaggedCount={3}
      onFilterChange={onFilterChange}
      onSortChange={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /^all$/i }))
  expect(onFilterChange).toHaveBeenCalledWith('all')
})

test('changing sort dropdown fires onSortChange', () => {
  const onSortChange = vi.fn()
  render(
    <TriageFilterRow
      filter="review"
      sort="confidence_asc"
      reviewCount={47}
      flaggedCount={0}
      onFilterChange={vi.fn()}
      onSortChange={onSortChange}
    />,
  )
  fireEvent.change(screen.getByLabelText(/sort/i), { target: { value: 'confidence_desc' } })
  expect(onSortChange).toHaveBeenCalledWith('confidence_desc')
})
