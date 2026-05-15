type Tone = 'primary' | 'moss' | 'brick' | 'muted'

const toneClass: Record<Tone, string> = {
  primary: 'border-ochre bg-ochre-dim text-paper',
  moss: 'border-moss text-moss',
  brick: 'border-brick text-brick',
  muted: 'border-edge text-on-surface',
}

interface DockButtonProps {
  label: string
  kbd: string
  tone: Tone
  onClick: () => void
  disabled?: boolean
}

export function DockButton({ label, kbd, tone, onClick, disabled = false }: DockButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-sm border font-mono text-[11px] tracking-[0.06em] uppercase disabled:opacity-40 ${toneClass[tone]}`}
    >
      <span className="text-ochre border border-edge px-1 rounded-sm text-[9.5px]">{kbd}</span>
      {label}
    </button>
  )
}
