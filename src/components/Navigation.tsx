// src/components/Navigation.tsx
import { NavLink } from 'react-router-dom'
import { Sun, Moon, Monitor } from 'lucide-react'
import { useTheme, type Theme } from '../hooks/useTheme'

const themeIcon: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }
const themeNext: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' }
const themeLabel: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' }

export function Navigation() {
  const { theme, setTheme } = useTheme()
  const Icon = themeIcon[theme]

  return (
    <nav className="flex items-center gap-6 px-6 py-3 border-b border-edge-subtle bg-canvas shrink-0">
      <span className="text-sm font-semibold text-on-canvas tracking-wide">Chatsight</span>
      <div className="flex gap-5 ml-4">
        {[
          { to: '/queue', label: 'Queue' },
          { to: '/history', label: 'History' },
          { to: '/labels', label: 'Labels' },
          { to: '/analysis', label: 'Analysis' },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `text-sm transition-colors ${isActive ? 'text-on-canvas' : 'text-muted hover:text-on-surface'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
      <button
        onClick={() => setTheme(themeNext[theme])}
        className="ml-auto p-1.5 rounded text-muted hover:text-on-surface hover:bg-elevated transition-colors"
        title={`Theme: ${themeLabel[theme]}`}
      >
        <Icon size={16} />
      </button>
    </nav>
  )
}
