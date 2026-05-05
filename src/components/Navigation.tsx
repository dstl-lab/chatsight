// src/components/Navigation.tsx
import { NavLink } from 'react-router-dom'
import { Sun, Moon, Monitor, Layers, Target } from 'lucide-react'
import { useTheme, type Theme } from '../hooks/useTheme'
import { useMode, type Mode } from '../hooks/useMode'

const themeIcon: Record<Theme, typeof Sun> = { light: Sun, dark: Moon, system: Monitor }
const themeNext: Record<Theme, Theme> = { light: 'dark', dark: 'system', system: 'light' }
const themeLabel: Record<Theme, string> = { light: 'Light', dark: 'Dark', system: 'System' }

const modeIcon: Record<Mode, typeof Layers> = { multi: Layers, single: Target }
const modeNext: Record<Mode, Mode> = { multi: 'single', single: 'multi' }
const modeLabel: Record<Mode, string> = { multi: 'Multi-label', single: 'Single-label' }

export function Navigation() {
  const { theme, setTheme } = useTheme()
  const { mode, setMode } = useMode()
  const ThemeIcon = themeIcon[theme]
  const ModeIcon = modeIcon[mode]

  // Single-label flow gets a leaner nav (matching the mock); multi keeps the full set.
  const labelingLink =
    mode === 'single' ? { to: '/run', label: 'Run' } : { to: '/queue', label: 'Queue' }
  const links =
    mode === 'single'
      ? [
          labelingLink,
          { to: '/labels', label: 'Labels' },
          { to: '/assignments', label: 'Assignments' },
          { to: '/summaries', label: 'Summaries' },
          { to: '/analysis', label: 'Analysis' },
        ]
      : [
          labelingLink,
          { to: '/history', label: 'History' },
          { to: '/labels', label: 'Labels' },
          { to: '/assignments', label: 'Assignments' },
          { to: '/summaries', label: 'Summaries' },
          { to: '/analysis', label: 'Analysis' },
        ]

  return (
    <nav className="flex items-center gap-7 px-7 py-3.5 border-b border-edge bg-canvas shrink-0">
      <span className="font-serif font-medium text-[18px] text-paper tracking-[-0.01em] leading-none">
        Chatsight<span className="text-ochre">.</span>
      </span>
      <div className="flex gap-5 ml-1">
        {links.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `font-mono text-[11px] tracking-[0.06em] uppercase transition-colors ${
                isActive ? 'text-paper' : 'text-muted hover:text-on-canvas'
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setMode(modeNext[mode])}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border font-mono text-[10px] tracking-[0.05em] transition-colors ${
            mode === 'single'
              ? 'border-ochre-dim text-ochre'
              : 'border-edge text-on-surface hover:text-on-canvas hover:border-faint'
          }`}
          title={`Mode: ${modeLabel[mode]} (click to switch)`}
        >
          <ModeIcon size={12} />
          <span className="hidden sm:inline">{modeLabel[mode]}</span>
        </button>
        <button
          onClick={() => setTheme(themeNext[theme])}
          className="inline-flex items-center px-2.5 py-1.5 rounded-full border border-edge text-on-surface hover:text-on-canvas hover:border-faint transition-colors"
          title={`Theme: ${themeLabel[theme]}`}
        >
          <ThemeIcon size={13} />
        </button>
      </div>
    </nav>
  )
}
