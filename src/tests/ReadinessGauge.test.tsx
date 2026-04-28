import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ReadinessGauge } from '../components/run/ReadinessGauge'

const base = { yes_count: 0, no_count: 0, skip_count: 0, conversations_walked: 0, total_conversations: 30, ready: false }

describe('ReadinessGauge', () => {
  it('shows gray tier with no decisions', () => {
    render(<ReadinessGauge state={base} />)
    expect(screen.getByTestId('readiness-tier').textContent).toBe('gray')
  })

  it('shows amber when both classes have decisions but few conversations walked', () => {
    render(<ReadinessGauge state={{ ...base, yes_count: 1, no_count: 1, conversations_walked: 2, ready: true }} />)
    expect(screen.getByTestId('readiness-tier').textContent).toBe('amber')
  })

  it('shows green when both classes covered and ≥ 5 conversations walked', () => {
    render(<ReadinessGauge state={{ ...base, yes_count: 3, no_count: 2, conversations_walked: 5, ready: true }} />)
    expect(screen.getByTestId('readiness-tier').textContent).toBe('green')
  })
})
