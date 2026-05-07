import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Mode = 'multi' | 'single'

const STORAGE_KEY = 'chatsight-mode'

type ModeContextValue = {
  mode: Mode
  setMode: (next: Mode) => void
}

const ModeContext = createContext<ModeContextValue | null>(null)

export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<Mode>(
    () => (localStorage.getItem(STORAGE_KEY) as Mode) || 'multi'
  )

  const setMode = useCallback((next: Mode) => {
    setModeState(next)
    localStorage.setItem(STORAGE_KEY, next)
  }, [])

  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>
}

export function useMode() {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used within ModeProvider')
  return ctx
}
