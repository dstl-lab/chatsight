/** Skipped or finished tutorial for this browser tab session (cleared on full page reload). */
const TUTORIAL_DONE_KEY = 'chatsight_run_tutorial_done'
const LEGACY_LOCAL_KEY = 'chatsight_onboarding_skipped'

/** Call once when the app bundle loads. Clears the skip flag on hard reload only. */
export function resetTutorialIfPageReload(): void {
  try {
    const nav = performance.getEntriesByType('navigation')[0] as
      | PerformanceNavigationTiming
      | undefined
    if (nav?.type === 'reload') {
      sessionStorage.removeItem(TUTORIAL_DONE_KEY)
    }
    // Stop honoring the old permanent localStorage skip from earlier iterations.
    localStorage.removeItem(LEGACY_LOCAL_KEY)
  } catch {
    /* ignore private mode / SSR */
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

/** @deprecated use runTutorialDone */
export const onboardingSkipped = runTutorialDone

/** @deprecated use markRunTutorialDone */
export const skipOnboardingTutorial = markRunTutorialDone

// Reset skip state as soon as this module loads (each full page load / reload).
resetTutorialIfPageReload()
