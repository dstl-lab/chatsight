import type { DecisionValue } from '../../types'

interface DecisionDockProps {
  onDecide: (value: DecisionValue) => void
  onUndo: () => void
  onHandoff: () => void
  onSkipConversation: () => void
  disabled?: boolean
  loading?: boolean
  /** When non-null, replaces the keyboard hints with a transient confirmation. */
  recent?: { value: DecisionValue; label: string } | null
}

export function DecisionDock({
  onDecide,
  onUndo,
  onHandoff,
  onSkipConversation,
  disabled,
  loading,
  recent,
}: DecisionDockProps) {
  return (
    <div className="px-12 py-[18px] pb-[22px] bg-canvas border-t border-edge">
      <div className="max-w-[760px] mx-auto flex flex-col items-center gap-3.5">
        <div className="flex gap-3 justify-center">
          <DecisionButton
            label="Yes"
            kbd="Y"
            tone="yes"
            onClick={() => onDecide('yes')}
            disabled={disabled}
          />
          <DecisionButton
            label="No"
            kbd="N"
            tone="no"
            onClick={() => onDecide('no')}
            disabled={disabled}
          />
          <DecisionButton
            label="Skip"
            kbd="S"
            tone="skip"
            onClick={() => onDecide('skip')}
            disabled={disabled}
          />
        </div>
        {loading ? (
          <div className="font-mono text-[10px] tracking-[0.08em] text-ochre animate-pulse">
            Saving decision and loading next message…
          </div>
        ) : recent ? (
          <RecentLine recent={recent} onUndo={onUndo} />
        ) : (
          <div className="flex gap-[22px] font-mono text-[10px] tracking-[0.08em] text-faint">
            <button onClick={onUndo} className="hover:text-on-canvas transition-colors">
              <KeyChip>Z</KeyChip> undo
            </button>
            <button
              onClick={onSkipConversation}
              className="hover:text-on-canvas transition-colors"
              title="Skip every remaining message in this conversation"
            >
              <KeyChip>⇧S</KeyChip> skip conversation
            </button>
            <button onClick={onHandoff} className="hover:text-on-canvas transition-colors">
              <KeyChip>⏎</KeyChip> hand off
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

const recentTone: Record<DecisionValue, string> = {
  yes: 'text-moss',
  no: 'text-brick',
  skip: 'text-stone',
}

function RecentLine({
  recent,
  onUndo,
}: {
  recent: { value: DecisionValue; label: string }
  onUndo: () => void
}) {
  const word = recent.value === 'yes' ? 'Yes' : recent.value === 'no' ? 'No' : 'Skip'
  return (
    <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.08em] animate-[fadeUp_.18s_ease-out]">
      <span className={`${recentTone[recent.value]} font-medium`}>● {word}</span>
      <span className="text-faint">marked for {recent.label}</span>
      <button
        onClick={onUndo}
        className="text-ochre hover:text-paper transition-colors border-b border-dashed border-ochre-dim"
      >
        undo (Z)
      </button>
    </div>
  )
}

function KeyChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-muted font-medium border border-edge px-[5px] py-px rounded-sm mr-1">
      {children}
    </span>
  )
}

const toneStyles: Record<'yes' | 'no' | 'skip', string> = {
  yes: 'hover:border-moss hover:text-moss [&_.kbd]:hover:text-moss-dim',
  no: 'hover:border-brick hover:text-brick [&_.kbd]:hover:text-brick-dim',
  skip: 'hover:border-stone hover:text-on-canvas',
}

interface DecisionButtonProps {
  label: string
  kbd: string
  tone: 'yes' | 'no' | 'skip'
  onClick: () => void
  disabled?: boolean
}

function DecisionButton({ label, kbd, tone, onClick, disabled }: DecisionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        appearance-none border border-edge bg-bg-warm text-on-canvas
        px-[26px] py-[13px] rounded-sm cursor-pointer
        font-serif font-normal text-[18px] tracking-[-0.01em]
        inline-flex items-baseline gap-[14px] justify-center min-w-[130px]
        transition-colors duration-150
        disabled:opacity-50 disabled:cursor-not-allowed
        ${toneStyles[tone]}
      `}
    >
      {label}
      <span className="kbd font-mono text-[10px] text-faint tracking-[0.08em]">{kbd}</span>
    </button>
  )
}
