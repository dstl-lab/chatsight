import { useState, useEffect } from 'react'
import type { LabelNameSuggestion } from '../../types'

interface LabelNameInputProps {
  value: string
  onChange: (value: string) => void
  onCommit?: () => void
  suggestions: LabelNameSuggestion[]
  placeholder?: string
  readOnly?: boolean
  autoFocus?: boolean
  className?: string
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
  'data-tutorial'?: string
}

export function LabelNameInput({
  value,
  onChange,
  onCommit,
  suggestions,
  placeholder,
  readOnly,
  autoFocus,
  className,
  onBlur,
  onKeyDown,
  ...rest
}: LabelNameInputProps) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)

  const filtered = suggestions.filter(
    (s) =>
      value.length > 0 &&
      s.name.toLowerCase().includes(value.toLowerCase()) &&
      s.name.toLowerCase() !== value.toLowerCase()
  )
  const showDropdown = open && filtered.length > 0

  useEffect(() => {
    setHighlighted(0)
  }, [value])

  function select(name: string) {
    onChange(name)
    setOpen(false)
    onCommit?.()
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showDropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlighted((h) => Math.min(h + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlighted((h) => Math.max(h - 1, 0))
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        select(filtered[highlighted].name)
        return
      }
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
    }
    onKeyDown?.(e)
  }

  return (
    <div className="relative">
      <input
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-haspopup="listbox"
        type="text"
        autoComplete="off"
        value={value}
        readOnly={readOnly}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={className}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => setOpen(false), 150); onBlur?.() }}
        onKeyDown={handleKeyDown}
        {...rest}
      />
      {showDropdown && (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-0.5 max-h-48 overflow-y-auto rounded-sm border border-edge bg-elevated shadow-lg"
        >
          {filtered.map((s, i) => (
            <li
              key={s.name}
              role="option"
              aria-selected={i === highlighted}
              className={`cursor-pointer px-3 py-2 ${
                i === highlighted ? 'bg-ochre/10' : 'hover:bg-surface'
              }`}
              onMouseDown={(e) => { e.preventDefault(); select(s.name) }}
              onMouseEnter={() => setHighlighted(i)}
            >
              <div className="text-sm font-semibold text-on-canvas">{s.name}</div>
              {s.description && (
                <div className="truncate text-xs text-muted">{s.description}</div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
