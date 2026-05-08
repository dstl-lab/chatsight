import type { SamplingPick } from '../../types'

interface ConversationMetaProps {
  chatlogId: number
  notebook: string | null
  turnCount: number
  samplingPick?: SamplingPick | null
  conversationStudentMessages?: number | null
  pendingStudentMessageNumber?: number | null
  neighborScoresAvailable?: boolean
  neighborUncertaintyPct?: number | null
  neighborNoveltyPct?: number | null
  samplingHint?: string | null
}

export function ConversationMeta({
  chatlogId,
  notebook,
  turnCount,
  samplingPick,
  conversationStudentMessages,
  pendingStudentMessageNumber,
  neighborScoresAvailable,
  neighborUncertaintyPct,
  neighborNoveltyPct,
  samplingHint,
}: ConversationMetaProps) {
  const showSampling =
    samplingPick != null &&
    conversationStudentMessages != null &&
    pendingStudentMessageNumber != null

  return (
    <div className="px-12 py-[11px] border-t border-b border-edge-subtle bg-canvas">
      <div className="max-w-[760px] mx-auto font-mono text-[10px] tracking-[0.14em] uppercase text-faint">
        Conversation #{chatlogId}
        {notebook && (
          <>
            <span className="mx-2.5 opacity-50">·</span>
            {notebook}
          </>
        )}
        <span className="mx-2.5 opacity-50">·</span>
        {turnCount} turns
      </div>
      {showSampling && (
        <div className="max-w-[760px] mx-auto mt-2 font-sans text-[11px] leading-snug text-muted normal-case tracking-normal">
          <span className="text-faint">Queue · </span>
          <span className={samplingPick === 'explore' ? 'text-ochre' : 'text-muted'}>
            {samplingPick === 'explore' ? 'Explore' : 'Round-robin'}
          </span>
          <span className="text-faint mx-1">·</span>
          Student message{' '}
          <span className="tabular-nums text-on-surface">
            {pendingStudentMessageNumber}/{conversationStudentMessages}
          </span>{' '}
          in this conversation (cached rows)
          {neighborScoresAvailable &&
            neighborUncertaintyPct != null &&
            neighborNoveltyPct != null && (
              <>
                <span className="text-faint mx-1">·</span>
                Ambiguity{' '}
                <span className="tabular-nums text-on-surface">{neighborUncertaintyPct}%</span>
                <span className="text-faint mx-1">·</span>
                Novelty{' '}
                <span className="tabular-nums text-on-surface">{neighborNoveltyPct}%</span>
              </>
            )}
          {samplingHint && (
            <span className="block mt-1 text-[10px] text-faint leading-relaxed">{samplingHint}</span>
          )}
        </div>
      )}
    </div>
  )
}
