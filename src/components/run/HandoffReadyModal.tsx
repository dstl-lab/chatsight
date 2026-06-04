interface HandoffReadyModalProps {
  onHandoff: () => void
  onDismiss: () => void
}

export function HandoffReadyModal({ onHandoff, onDismiss }: HandoffReadyModalProps) {
  return (
    <>
      <div className="fixed inset-0 bg-overlay z-40" onClick={onDismiss} />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,92vw)] bg-bg-warm border border-edge rounded-md shadow-2xl z-50"
      >
        <div className="px-[22px] pt-[20px] pb-3 border-b border-edge-subtle">
          <div className="font-mono text-[9px] tracking-[0.18em] uppercase text-moss mb-1.5">
            ✦ Ready
          </div>
          <h3 className="font-serif font-medium text-[22px] text-paper m-0 tracking-[-0.014em] leading-[1.2]">
            Handoff is ready
          </h3>
          <p className="mt-2 font-serif text-[13px] text-muted leading-[1.5]">
            You've labeled enough examples for Gemini to take over the rest. You can hand off now
            or keep labeling to improve accuracy.
          </p>
        </div>
        <div className="flex items-center gap-3 px-[22px] py-[18px]">
          <button
            onClick={onDismiss}
            className="appearance-none border border-edge bg-transparent text-on-surface px-4 py-[9px] rounded-sm cursor-pointer font-sans font-medium text-[13px] hover:text-on-canvas hover:border-faint transition-colors"
          >
            Keep labeling
          </button>
          <button
            onClick={onHandoff}
            className="appearance-none border border-moss bg-moss/10 text-moss px-4 py-[9px] rounded-sm cursor-pointer font-sans font-semibold text-[13px] hover:bg-moss/20 transition-colors"
          >
            Hand off to Gemini →
          </button>
        </div>
      </div>
    </>
  )
}
