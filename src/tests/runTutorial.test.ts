import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('runTutorial session gating', () => {
  beforeEach(() => {
    vi.resetModules()
    sessionStorage.clear()
    localStorage.clear()
  })

  it('offers tutorial when not skipped this session', async () => {
    const { shouldOfferTutorial, markRunTutorialDone } = await import(
      '../components/run/runTutorial'
    )
    expect(shouldOfferTutorial()).toBe(true)
    markRunTutorialDone()
    expect(shouldOfferTutorial()).toBe(false)
  })

  it('clears skip flag on performance reload navigation', async () => {
    const navEntry = { type: 'reload' } as PerformanceNavigationTiming
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([navEntry])

    sessionStorage.setItem('chatsight_run_tutorial_done', '1')
    localStorage.setItem('chatsight_onboarding_skipped', '1')

    const { shouldOfferTutorial } = await import('../components/run/runTutorial')
    expect(shouldOfferTutorial()).toBe(true)
    expect(localStorage.getItem('chatsight_onboarding_skipped')).toBeNull()
  })

  it('first-run tutorial requires no started runs and a document-load gate', async () => {
    sessionStorage.setItem('chatsight_run_tutorial_reload_gate', '1')
    const { shouldOfferFirstRunTutorial, takeTutorialReloadGate } = await import(
      '../components/run/runTutorial'
    )
    expect(shouldOfferFirstRunTutorial([])).toBe(true)
    takeTutorialReloadGate()
    expect(shouldOfferFirstRunTutorial([])).toBe(false)
    expect(
      shouldOfferFirstRunTutorial([
        {
          phase: 'labeling',
          is_active: true,
          yes_count: 1,
          no_count: 0,
          skip_count: 0,
        },
      ]),
    ).toBe(false)
  })

  it('unused labeling-phase rows do not block the tutorial', async () => {
    sessionStorage.setItem('chatsight_run_tutorial_reload_gate', '1')
    const { shouldOfferFirstRunTutorial } = await import('../components/run/runTutorial')
    expect(
      shouldOfferFirstRunTutorial([
        {
          phase: 'labeling',
          is_active: false,
          yes_count: 0,
          no_count: 0,
          skip_count: 0,
        },
      ]),
    ).toBe(true)
  })

  it('SPA return to /run does not re-open tutorial without a reload gate', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    const { shouldOfferFirstRunTutorial } = await import('../components/run/runTutorial')
    expect(shouldOfferFirstRunTutorial([])).toBe(false)
  })

  it('does not clear skip flag on SPA navigate', async () => {
    vi.resetModules()
    sessionStorage.clear()
    const navEntry = { type: 'navigate' } as PerformanceNavigationTiming
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([navEntry])

    sessionStorage.setItem('chatsight_run_tutorial_done', '1')

    const { shouldOfferTutorial } = await import('../components/run/runTutorial')
    expect(shouldOfferTutorial()).toBe(false)
  })
})
