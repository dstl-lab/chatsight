// src/tests/setup.ts
import '@testing-library/jest-dom'

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
