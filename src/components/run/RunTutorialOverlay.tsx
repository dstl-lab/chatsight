import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from 'react'

export type RunTutorialStep = 0 | 1 | 2 | 3

type AnchorId = 'label-name' | 'decision-dock' | 'note-label'

const DIM_COLOR = 'rgba(12, 10, 9, 0.42)'

const STEP_META: Record<
  RunTutorialStep,
  { title: string; lines: string[]; anchor: AnchorId | null; clickAnchorToAdvance?: boolean }
> = {
  0: {
    title: 'How labeling works',
    anchor: null,
    lines: [
      'Skim the student conversation one message at a time.',
      'Give your label a short name — what you want to find.',
      'Mark each message Yes or No for that label.',
      'After enough examples, AI can help label the rest.',
    ],
  },
  1: {
    title: 'Name your label',
    anchor: 'label-name',
    clickAnchorToAdvance: true,
    lines: [
      'Type a short name for what you want to track in these chats.',
      'Example: “Concept question” or “Debugging help”.',
    ],
  },
  2: {
    title: 'Yes, No, and Skip',
    anchor: 'decision-dock',
    lines: [
      'Yes — this message matches your label.',
      'No — it does not.',
      'Skip — move to another message or conversation.',
    ],
  },
  3: {
    title: 'Queue more labels',
    anchor: 'note-label',
    lines: [
      'If you think of another label to track, use + note a label.',
      'It waits in line until you finish the current one.',
    ],
  },
}

interface RunTutorialOverlayProps {
  step: RunTutorialStep
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

function TutorialCard({
  title,
  lines,
}: {
  title: string
  lines: string[]
}) {
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
        Click anywhere to continue · <kbd className="text-ochre">Space</kbd> skips tutorial
      </p>
    </div>
  )
}

function isSpaceKey(e: KeyboardEvent): boolean {
  return e.code === 'Space' || e.key === ' ' || e.key === 'Spacebar'
}

export function RunTutorialOverlay({ step, onAdvance, onSkip }: RunTutorialOverlayProps) {
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
      if (!isSpaceKey(e)) return
      e.preventDefault()
      e.stopPropagation()
      skip()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [skip])

  const pad = meta.anchor === 'label-name' ? 4 : 8
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
  } else if (meta.anchor === 'label-name') {
    popupStyle = {
      position: 'fixed',
      top: spotlight.top,
      left: Math.min(spotlight.left + spotlight.width + 16, window.innerWidth - 340),
      maxWidth: 320,
      zIndex: 63,
    }
  } else if (meta.anchor === 'decision-dock') {
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
      aria-label="Labeling tutorial"
      onClick={advance}
    >
      {step === 0 && (
        <div className="absolute inset-0" style={{ backgroundColor: DIM_COLOR }} aria-hidden />
      )}

      {spotlight && (
        <>
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
          {meta.clickAnchorToAdvance && (
            <button
              type="button"
              aria-label="Continue tutorial"
              className="absolute rounded-md cursor-pointer bg-transparent border-0"
              style={{
                top: spotlight.top,
                left: spotlight.left,
                width: spotlight.width,
                height: spotlight.height,
                zIndex: 61,
              }}
              onClick={(e) => {
                e.stopPropagation()
                advance()
              }}
            />
          )}
        </>
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
