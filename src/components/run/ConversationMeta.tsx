import type { SamplingPick } from '../../types'
import { HoverTip } from './HoverTip'

interface ConversationMetaProps {
  chatlogId: number
  notebook: string | null
  turnCount: number
  samplingPick?: SamplingPick | null
  conversationStudentMessages?: number | null
  pendingStudentMessageNumber?: number | null
}

const MONO = 'font-mono text-[10px] tracking-[0.14em] uppercase'

/** One-sentence overview of Explore serving (hover on Explore in meta bar). */
const EXPLORE_SERVE_TIP =
  'Explore serves chats scored for specificity, novelty, and rarity, avoiding copy-paste and ambiguity, for efficient labeling.'

function Sep() {
  return <span className="mx-1.5 opacity-50 shrink-0">·</span>
}

function pickLabel(pick: SamplingPick): string {
  switch (pick) {
    case 'explore':
      return 'Explore'
    case 'round_robin':
      return 'Robin'
    case 'continue':
      return 'Continue'
    default:
      return 'Continue'
  }
}

function pickTip(pick: SamplingPick): string {
  switch (pick) {
    case 'explore':
      return EXPLORE_SERVE_TIP
    case 'round_robin':
      return 'Next new conversation in fair rotation (not Explore scoring).'
    case 'continue':
      return 'Finishing a chat you already started before opening new ones.'
    default:
      return 'How this conversation entered the queue.'
  }
}

function pickTone(pick: SamplingPick): 'faint' | 'ochre' | 'paper' {
  if (pick === 'explore') return 'ochre'
  if (pick === 'continue') return 'paper'
  return 'faint'
}

export function ConversationMeta({
  chatlogId,
  notebook,
  turnCount,
  samplingPick,
  conversationStudentMessages,
  pendingStudentMessageNumber,
}: ConversationMetaProps) {
  const showQueue =
    samplingPick != null &&
    conversationStudentMessages != null &&
    pendingStudentMessageNumber != null

  const showPickChip = showQueue && samplingPick != null

  return (
    <div className={`px-12 py-5 border-t border-b border-edge-subtle bg-canvas ${MONO} text-faint`}>
      <div className="max-w-[760px] mx-auto overflow-x-auto overflow-y-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex flex-nowrap items-center whitespace-nowrap min-w-min">
          <span className="shrink-0 text-on-surface">Conversation #{chatlogId}</span>
          {notebook && (
            <>
              <Sep />
              <span className="shrink-0">{notebook}</span>
            </>
          )}
          <Sep />
          <span className="shrink-0">{turnCount} turns</span>

          {showQueue && (
            <>
              {showPickChip && (
                <>
                  <Sep />
                  <HoverTip
                    label={pickLabel(samplingPick)}
                    tip={pickTip(samplingPick)}
                    tone={pickTone(samplingPick)}
                  />
                </>
              )}
              <Sep />
              <HoverTip
                label={`Msg ${pendingStudentMessageNumber}/${conversationStudentMessages}`}
                tip={
                  `Labeling student message ${pendingStudentMessageNumber} of ` +
                  `${conversationStudentMessages} in this conversation.`
                }
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
