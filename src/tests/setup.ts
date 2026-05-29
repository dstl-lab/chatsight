// src/tests/setup.ts
import '@testing-library/jest-dom'
import { afterEach, beforeEach } from 'vitest'

// Reset persisted UI state between tests so values like `chatsight-keybinds`
// (set by keybind tests) and `chatsight-mode` don't leak across files and
// cause order-dependent flakes. Runs before each test's own beforeEach.
beforeEach(() => {
  localStorage.clear()
})

// Tests that focus an input (e.g. keyboard-shortcut suppression) can leave a
// focused element behind. A stale activeElement of INPUT/TEXTAREA trips the
// global keydown guard in QueuePage and makes another file's first shortcut
// test silently no-op, so blur after every test.
afterEach(() => {
  ;(document.activeElement as HTMLElement | null)?.blur?.()
})

// jsdom doesn't implement matchMedia — stub it for useTheme hook
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// jsdom doesn't implement Element.scrollTo — stub it for ThreadView's auto-scroll
Element.prototype.scrollTo = () => {}
