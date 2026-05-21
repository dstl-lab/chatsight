// src/tests/setup.ts
import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'

// Reset persisted UI state between tests so values like `chatsight-keybinds`
// (set by keybind tests) and `chatsight-mode` don't leak across files and
// cause order-dependent flakes. Runs before each test's own beforeEach.
beforeEach(() => {
  localStorage.clear()
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
