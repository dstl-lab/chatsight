/** Blocks interaction and shows a top progress bar while /run work is in flight. */
export function RunProgressOverlay({ message }: { message: string }) {
  return (
    <div
      className="pointer-events-auto fixed inset-0 z-[180] flex flex-col bg-canvas/45"
      aria-busy="true"
      aria-live="polite"
      role="status"
    >
      <div className="h-1 w-full shrink-0 overflow-hidden bg-edge-subtle">
        <div className="run-progress-indeterminate h-full bg-ochre" />
      </div>
      <div className="flex flex-1 items-start justify-center pt-14">
        <p className="rounded-sm border border-edge bg-bg-warm px-4 py-2 font-mono text-[11px] tracking-[0.14em] uppercase text-ochre shadow-lg">
          {message}
        </p>
      </div>
    </div>
  )
}
