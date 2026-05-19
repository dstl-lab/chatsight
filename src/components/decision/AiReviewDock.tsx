import { useKeybinds } from '../../hooks/useKeybinds'
import { DockButton } from './DockButton'

export type AiReviewMode =
  | { kind: 'review'; aiValue: 'yes' | 'no'; aiConfidence: number; position: number; total: number }
  | { kind: 'triage'; aiVerdict: 'yes' | 'no' }

export interface AiReviewDockProps {
  mode: AiReviewMode
  onYes: () => void
  onNo: () => void
  onSkip: () => void
  onUndo?: () => void
  onAcceptAi?: () => void
  canUndo?: boolean
  disabled?: boolean
}

export function AiReviewDock(props: AiReviewDockProps) {
  if (props.mode.kind === 'triage') return <TriageDockBody {...props} mode={props.mode} />
  return <ReviewDockBody {...props} mode={props.mode} />
}

interface TriageBodyProps extends AiReviewDockProps {
  mode: { kind: 'triage'; aiVerdict: 'yes' | 'no' }
}

function TriageDockBody({
  mode,
  onYes,
  onNo,
  onSkip,
  onUndo,
  onAcceptAi,
  canUndo,
  disabled = false,
}: TriageBodyProps) {
  const { keybinds } = useKeybinds()
  const aiIsYes = mode.aiVerdict === 'yes'
  const formatKey = (key: string) => {
    if (key === ' ') return '␣'
    return key.toUpperCase()
  }

  return (
    <div className="px-7 py-4 border-t border-edge bg-canvas flex items-center gap-2.5">
      <DockButton
        label={aiIsYes ? 'Keep YES' : 'Flip to YES'}
        kbd={formatKey(keybinds.yes)}
        tone={aiIsYes ? 'primary' : 'moss'}
        onClick={onYes}
        disabled={disabled}
      />
      <DockButton
        label={aiIsYes ? 'Flip to NO' : 'Keep NO'}
        kbd={formatKey(keybinds.no)}
        tone={aiIsYes ? 'brick' : 'primary'}
        onClick={onNo}
        disabled={disabled}
      />
      <DockButton
        label="Skip"
        kbd={formatKey(keybinds.skip)}
        tone="muted"
        onClick={onSkip}
        disabled={disabled}
      />
      {onUndo && (
        <DockButton
          label="Undo"
          kbd={formatKey(keybinds.undo)}
          tone="muted"
          onClick={onUndo}
          disabled={disabled || !canUndo}
        />
      )}
      {onAcceptAi && (
        <button
          onClick={onAcceptAi}
          disabled={disabled}
          className="ml-auto font-mono text-[10px] tracking-[0.12em] uppercase text-faint hover:text-paper disabled:opacity-40"
        >
          <span className="inline-block px-1.5 py-0.5 border border-edge rounded-sm mr-2 text-ochre">
            Enter
          </span>
          accept ai &amp; next
        </button>
      )}
    </div>
  )
}

interface ReviewBodyProps extends AiReviewDockProps {
  mode: { kind: 'review'; aiValue: 'yes' | 'no'; aiConfidence: number; position: number; total: number }
}

function ReviewDockBody({ mode, onYes, onNo, onSkip, disabled = false }: ReviewBodyProps) {
  const { keybinds } = useKeybinds()
  const aiIsYes = mode.aiValue === 'yes'
  const formatKey = (key: string) => {
    if (key === ' ') return '␣'
    return key.toUpperCase()
  }

  return (
    <div className="px-12 py-[18px] pb-[22px] bg-canvas border-t border-edge">
      <div className="max-w-[760px] mx-auto flex flex-col items-center gap-3.5">
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">
          Reviewing AI prediction {mode.position} of {mode.total}
          <span className="opacity-50 mx-2">·</span>
          confidence {mode.aiConfidence.toFixed(2)}
        </div>
        <div className="flex gap-2.5">
          <DockButton
            label={aiIsYes ? 'Confirm Yes' : 'Flip to Yes'}
            kbd={formatKey(keybinds.yes)}
            tone={aiIsYes ? 'primary' : 'moss'}
            onClick={onYes}
            disabled={disabled}
          />
          <DockButton
            label={aiIsYes ? 'Flip to No' : 'Confirm No'}
            kbd={formatKey(keybinds.no)}
            tone={aiIsYes ? 'brick' : 'primary'}
            onClick={onNo}
            disabled={disabled}
          />
          <DockButton
            label="Skip"
            kbd={formatKey(keybinds.skip)}
            tone="muted"
            onClick={onSkip}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}
