import { ConversationContext } from './ConversationContext'
import { VerdictBlock } from './VerdictBlock'
import { NoteEditor } from './NoteEditor'
import type { MessageDetail } from '../../types'

interface FocusedMessageProps {
  detail: MessageDetail
  reviewThreshold: number
  onAccept: () => void
  onFlip: (verdict: 'yes' | 'no') => void
  onFlag: () => void
  onSaveNote: (text: string) => void
}

export function FocusedMessage({
  detail, reviewThreshold, onAccept, onFlip, onFlag, onSaveNote,
}: FocusedMessageProps) {
  const nearThreshold =
    detail.applied_by === 'ai' &&
    detail.confidence !== null &&
    Math.abs(detail.confidence - reviewThreshold) < 0.1

  return (
    <div className="px-7 py-5 bg-bg-warm overflow-y-auto flex-1">
      <div className="font-mono text-[11px] text-muted mb-2">
        chatlog #{detail.chatlog_id}{detail.notebook ? ` · ${detail.notebook}` : ''}
      </div>
      <ConversationContext
        before={detail.context_before}
        after={detail.context_after}
        focusedText={detail.text}
        focusedTurnIndex={detail.turn_index}
        totalTurns={detail.total_turns}
      />
      <VerdictBlock
        verdict={detail.verdict}
        confidence={detail.confidence}
        appliedBy={detail.applied_by}
        matchedPattern={detail.matched_pattern}
        rationale={detail.rationale}
        nearThreshold={nearThreshold}
        onAccept={onAccept}
        onFlip={onFlip}
        onFlag={onFlag}
      />
      <NoteEditor note={detail.note} onSave={onSaveNote} />
    </div>
  )
}
