export const HUMAN_GLYPH = '👤'
export const HUMAN_TITLE = 'Labeled by human'

interface AppliedByGlyphProps {
  appliedBy: 'ai' | 'human' | null
  chatlogId: number
  messageIndex: number
}

export function AppliedByGlyph({ appliedBy, chatlogId, messageIndex }: AppliedByGlyphProps) {
  if (appliedBy !== 'human') return null
  return (
    <span
      data-testid={`applied-by-human-${chatlogId}-${messageIndex}`}
      title={HUMAN_TITLE}
      aria-label={HUMAN_TITLE}
      className="text-[11px] leading-none"
    >
      {HUMAN_GLYPH}
    </span>
  )
}
