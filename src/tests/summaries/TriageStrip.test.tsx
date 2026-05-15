import { render, screen } from '@testing-library/react'
import { TriageStrip } from '../../components/summaries/TriageStrip'

test('renders progress fraction when review_total > 0', () => {
  render(<TriageStrip cursor={22} reviewTotal={47} hiddenCount={10765} />)
  expect(screen.getByText('23 of 47 to review')).toBeInTheDocument()
  expect(screen.getByText(/10,765/)).toBeInTheDocument()
  expect(screen.getByText(/already trusted/i)).toBeInTheDocument()
})

test('renders "nothing to review" copy when review_total === 0', () => {
  render(<TriageStrip cursor={0} reviewTotal={0} hiddenCount={2000} />)
  expect(screen.getByText(/nothing to review/i)).toBeInTheDocument()
  expect(screen.queryByText(/\d+ of \d+ to review/)).not.toBeInTheDocument()
})

test('progress uses cursor + 1 (1-indexed display)', () => {
  render(<TriageStrip cursor={0} reviewTotal={47} hiddenCount={0} />)
  expect(screen.getByText('1 of 47 to review')).toBeInTheDocument()
})
