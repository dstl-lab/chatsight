import { useEffect, useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { useKeybinds, type Action } from '../../hooks/useKeybinds'

interface KeybindSettingsModalProps {
  open: boolean
  onClose: () => void
}

export function KeybindSettingsModal({ open, onClose }: KeybindSettingsModalProps) {
  const { keybinds, setKeybind, resetKeybinds } = useKeybinds()
  const [listeningFor, setListeningFor] = useState<Action | null>(null)

  useEffect(() => {
    if (!listeningFor) return

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      
      // We don't want to bind modifier keys by themselves
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return

      setKeybind(listeningFor, e.key)
      setListeningFor(null)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [listeningFor, setKeybind])

  if (!open) return null

  const actions: { id: Action; label: string }[] = [
    { id: 'yes', label: 'Yes' },
    { id: 'no', label: 'No' },
    { id: 'skip', label: 'Skip' },
    { id: 'undo', label: 'Undo / Back' },
  ]

  const formatKey = (key: string) => {
    if (key === ' ') return 'Space'
    if (key.length === 1) return key.toUpperCase()
    return key
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-canvas/80 backdrop-blur-sm animate-[fadeIn_.15s_ease-out]">
      <div className="bg-bg-warm border border-edge shadow-2xl w-full max-w-sm rounded-lg overflow-hidden flex flex-col">
        <div className="px-5 py-4 border-b border-edge flex items-center justify-between">
          <h2 className="font-serif text-lg text-on-canvas">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-on-canvas transition-colors p-1"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="font-sans text-[13px] text-on-surface leading-relaxed">
            Click an action to reassign its shortcut.
          </p>

          <div className="space-y-2">
            {actions.map((action) => (
              <div key={action.id} className="flex items-center justify-between group">
                <span className="font-sans text-sm text-on-canvas">{action.label}</span>
                <button
                  onClick={() => setListeningFor(action.id)}
                  className={`
                    min-w-[80px] px-3 py-1.5 rounded border font-mono text-xs transition-all
                    ${
                      listeningFor === action.id
                        ? 'bg-ochre border-ochre text-bg-warm animate-pulse'
                        : 'bg-surface border-edge text-on-canvas hover:border-ochre-dim'
                    }
                  `}
                >
                  {listeningFor === action.id ? '???' : formatKey(keybinds[action.id])}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 bg-surface/30 border-t border-edge flex items-center justify-between">
          <button
            onClick={resetKeybinds}
            className="inline-flex items-center gap-2 text-muted hover:text-ochre transition-colors font-mono text-[10px] tracking-widest uppercase"
          >
            <RotateCcw size={12} />
            Reset Defaults
          </button>
          <button
            onClick={onClose}
            className="bg-ochre text-bg-warm px-5 py-1.5 rounded-sm font-sans font-semibold text-sm hover:brightness-110 transition-all"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
