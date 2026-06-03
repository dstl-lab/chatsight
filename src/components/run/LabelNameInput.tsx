import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
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
  'data-note-input'?: string
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
  const [dropdownRect, setDropdownRect] = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = suggestions.filter(
    (s) =>
      s.name.toLowerCase() !== value.toLowerCase() &&
      (value.length === 0 || s.name.toLowerCase().includes(value.toLowerCase()))
  )
  const showDropdown = open && filtered.length > 0

  useEffect(() => {
    setHighlighted(0)
  }, [value])

  // Measure input position whenever dropdown opens so the portal is positioned correctly
  useEffect(() => {
    if (showDropdown && inputRef.current) {
      setDropdownRect(inputRef.current.getBoundingClientRect())
    }
  }, [showDropdown])

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

  const dropdown = showDropdown && dropdownRect ? createPortal(
    <ul
      role="listbox"
      style={{
        position: 'fixed',
        top: dropdownRect.bottom + 2,
        left: dropdownRect.left,
        width: dropdownRect.width,
        zIndex: 9999,
      }}
      className="max-h-48 overflow-y-auto rounded-sm border border-edge bg-elevated shadow-xl"
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
    </ul>,
    document.body
  ) : null

  return (
    <>
      <input
        ref={inputRef}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showDropdown}
        aria-haspopup="listbox"
        type="text"
        autoComplete="new-password"
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
      {dropdown}
    </>
  )
}
