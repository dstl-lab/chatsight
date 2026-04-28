import { useEffect } from 'react'
import type { DecisionValue } from '../../types'

interface Props {
  onDecide: (value: DecisionValue) => void
  disabled: boolean
}

export function DecisionBar({ onDecide, disabled }: Props) {
  useEffect(() => {
    if (disabled) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'y') onDecide('yes')
      else if (e.key === 'n') onDecide('no')
      else if (e.key === 's') onDecide('skip')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDecide, disabled])

  const baseBtn = 'flex-1 px-4 py-3 rounded font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'

  return (
    <div className="flex gap-2 w-full">
      <button
        className={`${baseBtn} bg-emerald-600 hover:bg-emerald-500 text-white`}
        disabled={disabled}
        onClick={() => onDecide('yes')}
      >
        Yes <span className="opacity-60 text-sm">(y)</span>
      </button>
      <button
        className={`${baseBtn} bg-rose-600 hover:bg-rose-500 text-white`}
        disabled={disabled}
        onClick={() => onDecide('no')}
      >
        No <span className="opacity-60 text-sm">(n)</span>
      </button>
      <button
        className={`${baseBtn} bg-neutral-700 hover:bg-neutral-600 text-white`}
        disabled={disabled}
        onClick={() => onDecide('skip')}
      >
        Skip <span className="opacity-60 text-sm">(s)</span>
      </button>
    </div>
  )
}
