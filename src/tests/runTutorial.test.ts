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

  it('first-run tutorial requires zero labels and a document-load gate', async () => {
    sessionStorage.setItem('chatsight_run_tutorial_reload_gate', '1')
    const { shouldOfferFirstRunTutorial, takeTutorialReloadGate } = await import(
      '../components/run/runTutorial'
    )
    expect(shouldOfferFirstRunTutorial(0)).toBe(true)
    takeTutorialReloadGate()
    expect(shouldOfferFirstRunTutorial(0)).toBe(false)
    expect(shouldOfferFirstRunTutorial(1)).toBe(false)
  })

  it('SPA return to /run does not re-open tutorial without a reload gate', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    const { shouldOfferFirstRunTutorial } = await import('../components/run/runTutorial')
    expect(shouldOfferFirstRunTutorial(0)).toBe(false)
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
