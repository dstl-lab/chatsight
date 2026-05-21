// Shared test render helper. Wraps components in the providers they need at
// runtime so unit tests don't have to repeat the boilerplate. Currently this is
// KeybindProvider (required by useKeybinds, used across queue/decision UI).
import type { ReactElement, ReactNode } from 'react'
import { render as rtlRender, type RenderOptions } from '@testing-library/react'
import { KeybindProvider } from '../hooks/useKeybinds'

function AllProviders({ children }: { children: ReactNode }) {
  return <KeybindProvider>{children}</KeybindProvider>
}

function render(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'>) {
  return rtlRender(ui, { wrapper: AllProviders, ...options })
}

// Re-export everything from RTL, then override `render` with the wrapped version.
export * from '@testing-library/react'
export { render }
