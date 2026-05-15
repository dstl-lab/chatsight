import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { DetailHeader } from '../../components/summaries/DetailHeader'
import type { SingleLabelDetail } from '../../types'

const detail: SingleLabelDetail = {
  id: 1, name: 'self-correction', description: 'catches mistakes', phase: 'handed_off',
  yes_count: 1142, no_count: 803, review_count: 91, review_threshold: 0.7,
  agreement_vs_gold: 0.87,
  confidence_histogram: Array.from({ length: 10 }, (_, i) => ({
    range_lo: i / 10, range_hi: (i + 1) / 10, count: i * 10,
  })),
}

test('renders title, description, and verdict counts', () => {
  render(<DetailHeader detail={detail} activeTab="browse" onTabChange={vi.fn()} onMenuAction={vi.fn()} />)
  expect(screen.getByText('self-correction')).toBeInTheDocument()
  expect(screen.getByText(/catches mistakes/)).toBeInTheDocument()
  expect(screen.getByText('1142')).toBeInTheDocument()
  expect(screen.getByText('803')).toBeInTheDocument()
  expect(screen.getByText('91')).toBeInTheDocument()
  expect(screen.getByText(/^Triage$/)).toBeInTheDocument()
})

test('tab strip emits onTabChange on click', () => {
  const onTabChange = vi.fn()
  render(<DetailHeader detail={detail} activeTab="browse" onTabChange={onTabChange} onMenuAction={vi.fn()} />)
  fireEvent.click(screen.getByText(/^Settings$/i))
  expect(onTabChange).toHaveBeenCalledWith('settings')
})

test('info panel renders sparkline + agreement when data is present', () => {
  render(<DetailHeader detail={detail} activeTab="browse" onTabChange={vi.fn()} onMenuAction={vi.fn()} />)
  expect(screen.getByRole('tooltip')).toBeInTheDocument()
  expect(screen.getByLabelText(/confidence distribution sparkline/i)).toBeInTheDocument()
  expect(screen.getByText('87%')).toBeInTheDocument()
})

test('info panel shows em-dash for agreement when null but histogram present', () => {
  render(
    <DetailHeader
      detail={{ ...detail, agreement_vs_gold: null }}
      activeTab="browse"
      onTabChange={vi.fn()}
      onMenuAction={vi.fn()}
    />,
  )
  expect(screen.getByRole('tooltip')).toBeInTheDocument()
  expect(screen.getByText('—')).toBeInTheDocument()
})

test('info icon suppressed when neither agreement nor histogram present', () => {
  render(
    <DetailHeader
      detail={{ ...detail, agreement_vs_gold: null, confidence_histogram: [] }}
      activeTab="browse"
      onTabChange={vi.fn()}
      onMenuAction={vi.fn()}
    />,
  )
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
})
