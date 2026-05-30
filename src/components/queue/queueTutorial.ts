/** Skipped or finished queue tutorial for this browser tab session (cleared on full page reload). */
const TUTORIAL_DONE_KEY = 'chatsight_queue_tutorial_done'
/** Set on document load (reload or first navigate); consumed when /queue offers the overlay once. */
const TUTORIAL_RELOAD_GATE_KEY = 'chatsight_queue_tutorial_reload_gate'

/** Call once when the app bundle loads (not on in-app route changes). */
export function resetQueueTutorialIfPageReload(): void {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (nav?.type === 'reload') {
      sessionStorage.removeItem(TUTORIAL_DONE_KEY)
      sessionStorage.setItem(TUTORIAL_RELOAD_GATE_KEY, '1')
    } else if (nav?.type === 'navigate') {
      sessionStorage.setItem(TUTORIAL_RELOAD_GATE_KEY, '1')
    }
  } catch {
    /* ignore private mode / SSR */
  }
}

export function peekQueueTutorialReloadGate(): boolean {
  try {
    return sessionStorage.getItem(TUTORIAL_RELOAD_GATE_KEY) === '1'
  } catch {
    return false
  }
}

/** One-shot: true only once per document load before SPA hops consume it. */
export function takeQueueTutorialReloadGate(): boolean {
  try {
    if (!peekQueueTutorialReloadGate()) return false
    sessionStorage.removeItem(TUTORIAL_RELOAD_GATE_KEY)
    return true
  } catch {
    return false
  }
}

export function queueTutorialDone(): boolean {
  try {
    return sessionStorage.getItem(TUTORIAL_DONE_KEY) === '1'
  } catch {
    return false
  }
}

export function markQueueTutorialDone(): void {
  try {
    sessionStorage.setItem(TUTORIAL_DONE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function shouldOfferQueueTutorial(): boolean {
  return !queueTutorialDone()
}

/**
 * True once the instructor has created any labels or labeled at least one message.
 * Mirrors single-label `hasStartedSingleLabelRun`: empty taxonomy + no work yet.
 */
export function hasStartedMultiLabelWorkflow(labelCount: number, labeledCount: number): boolean {
  return labelCount > 0 || labeledCount > 0
}

/**
 * First-run overlay: no labels and no labeled messages yet, not skipped this session,
 * and this visit came from a document load (reload / new tab) — not Queue via SPA nav.
 */
export function shouldOfferFirstQueueTutorial(labelCount: number, labeledCount: number): boolean {
  if (hasStartedMultiLabelWorkflow(labelCount, labeledCount) || !shouldOfferQueueTutorial()) {
    return false
  }
  return peekQueueTutorialReloadGate()
}

resetQueueTutorialIfPageReload()
