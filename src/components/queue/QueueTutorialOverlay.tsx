import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'

export type QueueTutorialStep = 0 | 1 | 2 | 3 | 4

type AnchorId = 'student-message' | 'label-list' | 'advance-controls' | 'ai-milestones'

const DIM_COLOR = 'rgba(12, 10, 9, 0.42)'

const STEP_META: Record<
  QueueTutorialStep,
  { title: string; lines: string[]; anchor: AnchorId | null }
> = {
  0: {
    title: 'How the queue works',
    anchor: null,
    lines: [
      'Work through student messages one at a time.',
      'Toggle any labels that apply — a message can have several.',
      'Press Next when you are done with this message.',
      'After enough examples, AI can suggest and auto-label the rest.',
    ],
  },
  1: {
    title: 'Read the message',
    anchor: 'student-message',
    lines: [
      'Each card is one student turn in a tutoring chat.',
      'Expand context above or below when you need more thread.',
    ],
  },
  2: {
    title: 'Toggle labels',
    anchor: 'label-list',
    lines: [
      'Click a label to apply or remove it on this message.',
      'Use keys 1–9 for the first nine labels in the list.',
      'Need a new category? Use + New label.',
    ],
  },
  3: {
    title: 'Next and Skip',
    anchor: 'advance-controls',
    lines: [
      'Next — save your labels and move to the next message.',
      'Skip — leave this message unlabeled for now.',
    ],
  },
  4: {
    title: 'AI unlocks with practice',
    anchor: 'ai-milestones',
    lines: [
      'After 20 labeled messages, Gemini suggests labels on each card.',
      'After more examples, Auto-label can finish the remaining queue.',
    ],
  },
}

interface QueueTutorialOverlayProps {
  step: QueueTutorialStep
  onAdvance: () => void
  onSkip: () => void
}

function useAnchorRect(anchor: AnchorId | null): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useLayoutEffect(() => {
    if (!anchor) {
      setRect(null)
      return
    }
    const measure = () => {
      const el = document.querySelector(`[data-tutorial="${anchor}"]`)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    measure()
    const t = window.setTimeout(measure, 50)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [anchor])

  return rect
}

function TutorialCard({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="bg-bg-warm border border-edge rounded-lg shadow-2xl max-w-md w-full p-5 pointer-events-none"
    >
      <h2 className="font-serif text-xl text-on-canvas tracking-tight mb-3">{title}</h2>
      <ol className="font-serif text-sm text-muted space-y-2 list-none">
        {lines.map((line, i) => (
          <li key={line} className="flex gap-2 leading-relaxed">
            {lines.length > 1 && (
              <span className="text-ochre font-mono text-[10px] shrink-0 pt-0.5">{i + 1}</span>
            )}
            <span>{line}</span>
          </li>
        ))}
      </ol>
      <p className="mt-4 font-mono text-[10px] tracking-[0.12em] uppercase text-faint">
        Click anywhere to continue · <kbd className="text-ochre">Esc</kbd> skips tutorial
      </p>
    </div>
  )
}

export function QueueTutorialOverlay({ step, onAdvance, onSkip }: QueueTutorialOverlayProps) {
  const meta = STEP_META[step]
  const anchorRect = useAnchorRect(meta.anchor)

  const advance = useCallback(() => {
    onAdvance()
  }, [onAdvance])

  const skip = useCallback(() => {
    onSkip()
  }, [onSkip])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      skip()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [skip])

  const pad = 8
  const spotlight =
    anchorRect != null
      ? {
          top: anchorRect.top - pad,
          left: anchorRect.left - pad,
          width: anchorRect.width + pad * 2,
          height: anchorRect.height + pad * 2,
        }
      : null

  let popupStyle: CSSProperties = { zIndex: 63 }
  if (step === 0 || !spotlight) {
    popupStyle = { zIndex: 63 }
  } else if (meta.anchor === 'student-message') {
    popupStyle = {
      position: 'fixed',
      top: Math.min(spotlight.top, window.innerHeight - 280),
      left: Math.min(spotlight.left + spotlight.width + 16, window.innerWidth - 340),
      maxWidth: 320,
      zIndex: 63,
    }
  } else if (meta.anchor === 'label-list') {
    popupStyle = {
      position: 'fixed',
      top: spotlight.top,
      left: Math.min(spotlight.left + spotlight.width + 16, window.innerWidth - 340),
      maxWidth: 320,
      zIndex: 63,
    }
  } else if (meta.anchor === 'advance-controls') {
    popupStyle = {
      position: 'fixed',
      bottom: window.innerHeight - spotlight.top + 12,
      left: '50%',
      transform: 'translateX(-50%)',
      maxWidth: 360,
      zIndex: 63,
    }
  } else {
    popupStyle = {
      position: 'fixed',
      top: spotlight.top + spotlight.height + 12,
      left: Math.max(16, spotlight.left),
      maxWidth: 320,
      zIndex: 63,
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] pointer-events-auto"
      aria-label="Queue tutorial"
      onClick={advance}
    >
      {step === 0 && (
        <div className="absolute inset-0" style={{ backgroundColor: DIM_COLOR }} aria-hidden />
      )}

      {spotlight && (
        <div
          className="absolute rounded-md pointer-events-none"
          style={{
            top: spotlight.top,
            left: spotlight.left,
            width: spotlight.width,
            height: spotlight.height,
            boxShadow: `0 0 0 9999px ${DIM_COLOR}`,
          }}
        />
      )}

      {step === 0 ? (
        <div
          className="absolute inset-0 flex items-center justify-center p-6 z-[62] pointer-events-none"
          onClick={(e) => e.stopPropagation()}
        >
          <TutorialCard title={meta.title} lines={meta.lines} />
        </div>
      ) : (
        <div
          style={popupStyle}
          className="p-2 pointer-events-none"
          onClick={(e) => e.stopPropagation()}
        >
          <TutorialCard title={meta.title} lines={meta.lines} />
        </div>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          skip()
        }}
        className="fixed bottom-6 right-6 z-[64] px-4 py-2 text-xs font-mono tracking-wide text-faint hover:text-paper border border-edge rounded-sm bg-bg-warm/95 backdrop-blur-sm"
      >
        Skip tutorial
      </button>
    </div>
  )
}
