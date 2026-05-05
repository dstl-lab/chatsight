interface ReviewDockProps {
  aiValue: 'yes' | 'no'
  aiConfidence: number
  position: number
  total: number
  onConfirm: () => void   // mark the AI prediction as human-validated
  onFlip: () => void      // flip yes↔no, mark human
  onSkip: () => void      // leave AI prediction as-is, advance
  disabled?: boolean
}

export function ReviewDock({
  aiValue,
  aiConfidence,
  position,
  total,
  onConfirm,
  onFlip,
  onSkip,
  disabled,
}: ReviewDockProps) {
  const isYes = aiValue === 'yes'
  return (
    <div className="px-12 py-[18px] pb-[22px] bg-canvas border-t border-edge">
      <div className="max-w-[760px] mx-auto flex flex-col items-center gap-3.5">
        <div className="font-mono text-[10px] tracking-[0.16em] uppercase text-faint">
          Reviewing AI prediction {position} of {total}
          <span className="opacity-50 mx-2">·</span>
          confidence {aiConfidence.toFixed(2)}
        </div>
        <div className="flex gap-3 justify-center">
          <ReviewButton
            label={isYes ? 'Confirm Yes' : 'Confirm No'}
            tone={isYes ? 'yes' : 'no'}
            kbd={isYes ? 'Y' : 'N'}
            onClick={onConfirm}
            disabled={disabled}
          />
          <ReviewButton
            label={isYes ? 'Flip to No' : 'Flip to Yes'}
            tone={isYes ? 'no' : 'yes'}
            kbd={isYes ? 'N' : 'Y'}
            onClick={onFlip}
            disabled={disabled}
          />
          <ReviewButton
            label="Skip"
            tone="skip"
            kbd="S"
            onClick={onSkip}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  )
}

const toneStyles: Record<'yes' | 'no' | 'skip', string> = {
  yes: 'hover:border-moss hover:text-moss [&_.kbd]:hover:text-moss-dim',
  no: 'hover:border-brick hover:text-brick [&_.kbd]:hover:text-brick-dim',
  skip: 'hover:border-stone hover:text-on-canvas',
}

interface ReviewButtonProps {
  label: string
  tone: 'yes' | 'no' | 'skip'
  kbd: string
  onClick: () => void
  disabled?: boolean
}

function ReviewButton({ label, tone, kbd, onClick, disabled }: ReviewButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        appearance-none border border-edge bg-bg-warm text-on-canvas
        px-[20px] py-[13px] rounded-sm cursor-pointer
        font-serif font-normal text-[16px] tracking-[-0.01em]
        inline-flex items-baseline gap-[12px] justify-center min-w-[140px]
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
