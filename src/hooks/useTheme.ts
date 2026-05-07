import { useState, useEffect, useCallback } from 'react'

export type Theme = 'light' | 'dark' | 'system'

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem('chatsight-theme') as Theme) || 'system'
  )

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    localStorage.setItem('chatsight-theme', next)
    document.documentElement.setAttribute('data-theme', resolveTheme(next))
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(theme))

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const handler = () =>
        document.documentElement.setAttribute('data-theme', resolveTheme('system'))
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [theme])

  return { theme, setTheme, resolvedTheme: resolveTheme(theme) }
}
