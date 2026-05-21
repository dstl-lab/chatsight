import { useEffect, useRef, type ReactNode } from 'react'
import { ThreadView } from '../run/ThreadView'
import { useKeybinds } from '../../hooks/useKeybinds'
import type { ConversationTurn } from '../../types'

export interface DecisionWorkspaceProps {
  thread: ConversationTurn[]
  focusIndex: number
  header?: ReactNode
  flank?: ReactNode
  dock: ReactNode
  emptyState?: ReactNode
  onYes?: () => void
  onNo?: () => void
  onSkip?: () => void
  onUndo?: () => void
  onAcceptAi?: () => void
  disabled?: boolean
}

export function DecisionWorkspace({
  thread,
  focusIndex,
  header,
  flank,
  dock,
  emptyState,
  onYes,
  onNo,
  onSkip,
  onUndo,
  onAcceptAi,
  disabled = false,
}: DecisionWorkspaceProps) {
  const { keybinds } = useKeybinds()
  const handlersRef = useRef({ onYes, onNo, onSkip, onUndo, onAcceptAi, disabled, keybinds })
  useEffect(() => {
    handlersRef.current = { onYes, onNo, onSkip, onUndo, onAcceptAi, disabled, keybinds }
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName ?? ''
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        el?.isContentEditable ||
        el?.getAttribute('contenteditable') === 'true'
      )
        return
      const h = handlersRef.current
      if (h.disabled) return
      // Non-shift modifiers are reserved for callers' bespoke handlers.
      if (e.ctrlKey || e.altKey || e.metaKey) return

      const rawKey = e.key.toLowerCase()
      const pressedKey = e.shiftKey ? `shift+${rawKey}` : rawKey
      const k = h.keybinds

      if (pressedKey === k.yes) {
        h.onYes?.()
      } else if (pressedKey === k.no) {
        h.onNo?.()
      } else if (pressedKey === k.skip) {
        if (rawKey === ' ') e.preventDefault() // prevent scroll
        h.onSkip?.()
      } else if (pressedKey === k.undo) {
        h.onUndo?.()
      } else if (pressedKey === 'enter' || rawKey === 'enter') {
        h.onAcceptAi?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isEmpty = thread.length === 0
  const bodyCols = flank ? 'grid-cols-[1fr_320px]' : 'grid-cols-[1fr]'

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-canvas">
      {header}
      <div
        data-region="body"
        className={`flex-1 min-h-0 overflow-hidden grid ${bodyCols}`}
      >
        {isEmpty ? (
          /* col-span-full centers across both columns when flank is present; harmless in 1-col */
          <div className="col-span-full flex items-center justify-center">{emptyState}</div>
        ) : (
          <>
            <ThreadView thread={thread} focusIndex={focusIndex} />
            {flank}
          </>
        )}
      </div>
      {dock}
    </div>
  )
}
