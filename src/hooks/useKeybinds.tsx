import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export type Action = 'yes' | 'no' | 'skip' | 'undo'

export type KeybindMap = Record<Action, string>

const STORAGE_KEY = 'chatsight-keybinds'

const DEFAULT_KEYBINDS: KeybindMap = {
  yes: 'a',
  no: 'd',
  skip: ' ', // Space
  undo: 's',
}

type KeybindContextValue = {
  keybinds: KeybindMap
  setKeybind: (action: Action, key: string) => void
  resetKeybinds: () => void
}

const KeybindContext = createContext<KeybindContextValue | null>(null)

export function KeybindProvider({ children }: { children: ReactNode }) {
  const [keybinds, setKeybindsState] = useState<KeybindMap>(() => {
    if (typeof localStorage === 'undefined') return DEFAULT_KEYBINDS
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return DEFAULT_KEYBINDS
    try {
      return { ...DEFAULT_KEYBINDS, ...JSON.parse(saved) }
    } catch {
      return DEFAULT_KEYBINDS
    }
  })

  const setKeybind = useCallback((action: Action, key: string) => {
    setKeybindsState((prev) => {
      const next = { ...prev, [action]: key.toLowerCase() }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      }
      return next
    })
  }, [])

  const resetKeybinds = useCallback(() => {
    setKeybindsState(DEFAULT_KEYBINDS)
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  return (
    <KeybindContext.Provider value={{ keybinds, setKeybind, resetKeybinds }}>
      {children}
    </KeybindContext.Provider>
  )
}

export function useKeybinds() {
  const ctx = useContext(KeybindContext)
  if (!ctx) throw new Error('useKeybinds must be used within KeybindProvider')
  return ctx
}
