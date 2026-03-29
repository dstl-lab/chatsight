// src/components/Navigation.tsx
import { NavLink } from 'react-router-dom'

export function Navigation() {
  return (
    <nav className="flex items-center gap-6 px-6 py-3 border-b border-neutral-800 bg-neutral-950 shrink-0">
      <span className="text-sm font-semibold text-white tracking-wide">Chatsight</span>
      <div className="flex gap-5 ml-4">
        {[
          { to: '/queue', label: 'Queue' },
          { to: '/labels', label: 'Labels' },
          { to: '/analysis', label: 'Analysis' },
        ].map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `text-sm transition-colors ${isActive ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'}`
            }
          >
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
