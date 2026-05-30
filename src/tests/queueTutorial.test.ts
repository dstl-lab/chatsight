import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('queueTutorial session gating', () => {
  beforeEach(() => {
    vi.resetModules()
    sessionStorage.clear()
  })

  it('offers tutorial when not skipped this session', async () => {
    const { shouldOfferQueueTutorial, markQueueTutorialDone } = await import(
      '../components/queue/queueTutorial'
    )
    expect(shouldOfferQueueTutorial()).toBe(true)
    markQueueTutorialDone()
    expect(shouldOfferQueueTutorial()).toBe(false)
  })

  it('clears skip flag on performance reload navigation', async () => {
    const navEntry = { type: 'reload' } as PerformanceNavigationTiming
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([navEntry])

    sessionStorage.setItem('chatsight_queue_tutorial_done', '1')

    const { shouldOfferQueueTutorial } = await import('../components/queue/queueTutorial')
    expect(shouldOfferQueueTutorial()).toBe(true)
  })

  it('first-run tutorial requires zero labels, zero labeled messages, and a document-load gate', async () => {
    sessionStorage.setItem('chatsight_queue_tutorial_reload_gate', '1')
    const { shouldOfferFirstQueueTutorial, takeQueueTutorialReloadGate } = await import(
      '../components/queue/queueTutorial'
    )
    expect(shouldOfferFirstQueueTutorial(0, 0)).toBe(true)
    takeQueueTutorialReloadGate()
    expect(shouldOfferFirstQueueTutorial(0, 0)).toBe(false)
    expect(shouldOfferFirstQueueTutorial(0, 1)).toBe(false)
    expect(shouldOfferFirstQueueTutorial(1, 0)).toBe(false)
  })

  it('existing labels block the tutorial even with zero labeled messages', async () => {
    sessionStorage.setItem('chatsight_queue_tutorial_reload_gate', '1')
    const { shouldOfferFirstQueueTutorial } = await import('../components/queue/queueTutorial')
    expect(shouldOfferFirstQueueTutorial(3, 0)).toBe(false)
  })

  it('SPA return to /queue does not re-open tutorial without a reload gate', async () => {
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([])
    const { shouldOfferFirstQueueTutorial } = await import('../components/queue/queueTutorial')
    expect(shouldOfferFirstQueueTutorial(0, 0)).toBe(false)
  })
})
