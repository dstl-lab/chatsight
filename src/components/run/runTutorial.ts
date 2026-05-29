/** Skipped or finished tutorial for this browser tab session (cleared on full page reload). */
const TUTORIAL_DONE_KEY = 'chatsight_run_tutorial_done'
/** Set on document load (reload or first navigate); consumed when /run offers the overlay once. */
const TUTORIAL_RELOAD_GATE_KEY = 'chatsight_run_tutorial_reload_gate'
const LEGACY_LOCAL_KEY = 'chatsight_onboarding_skipped'

/** Call once when the app bundle loads (not on in-app route changes). */
export function resetTutorialIfPageReload(): void {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (nav?.type === 'reload') {
      sessionStorage.removeItem(TUTORIAL_DONE_KEY)
      sessionStorage.setItem(TUTORIAL_RELOAD_GATE_KEY, '1')
    } else if (nav?.type === 'navigate') {
      // First load in this tab (typed URL, new tab) — same one-shot offer as reload.
      sessionStorage.setItem(TUTORIAL_RELOAD_GATE_KEY, '1')
    }
    // Stop honoring the old permanent localStorage skip from earlier iterations.
    localStorage.removeItem(LEGACY_LOCAL_KEY)
  } catch {
    /* ignore private mode / SSR */
  }
}

export function peekTutorialReloadGate(): boolean {
  try {
    return sessionStorage.getItem(TUTORIAL_RELOAD_GATE_KEY) === '1'
  } catch {
    return false
  }
}

/** One-shot: true only once per document load before SPA hops consume it. */
export function takeTutorialReloadGate(): boolean {
  try {
    if (!peekTutorialReloadGate()) return false
    sessionStorage.removeItem(TUTORIAL_RELOAD_GATE_KEY)
    return true
  } catch {
    return false
  }
}

export function runTutorialDone(): boolean {
  try {
    return sessionStorage.getItem(TUTORIAL_DONE_KEY) === '1'
  } catch {
    return false
  }
}

export function markRunTutorialDone(): void {
  try {
    sessionStorage.setItem(TUTORIAL_DONE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function shouldOfferTutorial(): boolean {
  return !runTutorialDone()
}

/** Minimal label fields used to decide if first-run tutorial still applies. */
export type TutorialLabelSnapshot = {
  phase: string
  is_active: boolean
  yes_count: number
  no_count: number
  skip_count: number
}

/** True when the instructor has already started or finished at least one real run. */
export function hasStartedSingleLabelRun(labels: TutorialLabelSnapshot[]): boolean {
  return labels.some(
    (l) =>
      l.is_active ||
      l.phase !== 'labeling' ||
      l.yes_count + l.no_count + l.skip_count > 0,
  )
}

/**
 * First-run overlay: no started runs yet, not skipped this session, and this visit
 * came from a document load (reload / new tab) — not from Summaries → Run in-SPA.
 * Unused labeling-phase rows (name typed then abandoned) do not block the tutorial.
 */
export function shouldOfferFirstRunTutorial(labels: TutorialLabelSnapshot[]): boolean {
  if (hasStartedSingleLabelRun(labels) || !shouldOfferTutorial()) return false
  return peekTutorialReloadGate()
}

/** @deprecated use runTutorialDone */
export const onboardingSkipped = runTutorialDone

/** @deprecated use markRunTutorialDone */
export const skipOnboardingTutorial = markRunTutorialDone

// Reset skip state as soon as this module loads (each full page load / reload).
resetTutorialIfPageReload()
