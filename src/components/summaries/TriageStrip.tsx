interface TriageStripProps {
  cursor: number
  reviewTotal: number
  hiddenCount: number
}

export function TriageStrip({ cursor, reviewTotal, hiddenCount }: TriageStripProps) {
  if (reviewTotal === 0) {
    return (
      <div className="px-7 py-3 border-b border-edge-subtle bg-canvas flex items-center">
        <span className="font-mono text-[11px] tracking-[0.12em] text-muted">
          Nothing to review for this label — all predictions cleared the confidence threshold.
        </span>
      </div>
    )
  }

  return (
    <div className="px-7 py-3 border-b border-edge-subtle bg-canvas flex items-center justify-between">
      <span className="font-mono text-[12px] tracking-[0.08em] text-paper">
        {`${cursor + 1} of ${reviewTotal} to review`}
      </span>
      <span className="font-mono text-[10px] tracking-[0.12em] text-faint uppercase">
        {`${hiddenCount.toLocaleString()} hidden · already trusted`}
      </span>
    </div>
  )
}
