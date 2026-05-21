import type { SamplingPick } from '../../types'
import { HoverTip } from './HoverTip'

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
  conversationNoveltyPct?: number | null
  themeNoveltyPct?: number | null
  studentSpecificityPct?: number | null
  studentRarityPct?: number | null
}

const MONO = 'font-mono text-[10px] tracking-[0.14em] uppercase'

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
      return (
        'Explore queue opened this as a new conversation. We favor chats with specific, ' +
        'uncommon student questions — not generic “help” or copy-pasted prompts.'
      )
    case 'round_robin':
      return (
        'Round-robin queue: next new conversation in a fair fixed order ' +
        '(grouped by assignment, then shuffled).'
      )
    case 'continue':
      return (
        'You already labeled part of this chat — the queue keeps you here until ' +
        'it is finished before picking new conversations.'
      )
    default:
      return 'How this conversation was chosen from the labeling queue.'
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
  neighborScoresAvailable,
  neighborUncertaintyPct,
  neighborNoveltyPct,
  conversationNoveltyPct,
  themeNoveltyPct,
  studentSpecificityPct,
  studentRarityPct,
}: ConversationMetaProps) {
  const showQueue =
    samplingPick != null &&
    conversationStudentMessages != null &&
    pendingStudentMessageNumber != null

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
              <Sep />
              <HoverTip
                label={pickLabel(samplingPick)}
                tip={pickTip(samplingPick)}
                tone={pickTone(samplingPick)}
              />
              <Sep />
              <HoverTip
                label={`Msg ${pendingStudentMessageNumber}/${conversationStudentMessages}`}
                tip={
                  `Labeling student message ${pendingStudentMessageNumber} of ` +
                  `${conversationStudentMessages} in this conversation (from the local cache).`
                }
              />
              {neighborScoresAvailable &&
                neighborUncertaintyPct != null &&
                neighborNoveltyPct != null && (
                  <>
                    <Sep />
                    <HoverTip
                      label={`Amb ${neighborUncertaintyPct}%`}
                      tip={
                        'Ambiguity from your nearest labeled neighbors: similar past messages ' +
                        'disagree on yes vs no. Higher means a harder borderline call.'
                      }
                    />
                    <Sep />
                    <HoverTip
                      label={`Msg nov ${neighborNoveltyPct}%`}
                      tip={
                        'Message novelty: this student line looks different from individual ' +
                        'messages you already labeled (embedding similarity).'
                      }
                    />
                  </>
                )}
              {conversationNoveltyPct != null && (
                <>
                  <Sep />
                  <HoverTip
                    label={`Conv nov ${conversationNoveltyPct}%`}
                    tip={
                      'Conversation novelty: overall student messages in this chat look unlike ' +
                      'chats where you already applied this label.'
                    }
                  />
                </>
              )}
              {themeNoveltyPct != null && (
                <>
                  <Sep />
                  <HoverTip
                    label={`Theme ${themeNoveltyPct}%`}
                    tip={
                      'Theme novelty: the main topic of this chat is unlike themes in ' +
                      'conversations you have already walked for this label.'
                    }
                  />
                </>
              )}
              {studentSpecificityPct != null && (
                <>
                  <Sep />
                  <HoverTip
                    label={`Spec ${studentSpecificityPct}%`}
                    tip={
                      'Specificity: this looks like a real student question in their own words — ' +
                      'not vague “help”, question numbers only, or pasted assignment/error text.'
                    }
                  />
                </>
              )}
              {studentRarityPct != null && (
                <>
                  <Sep />
                  <HoverTip
                    label={`Rare ${studentRarityPct}%`}
                    tip={
                      'Rarity: this wording is uncommon compared to other student messages ' +
                      'in the course corpus (many students did not ask it this way).'
                    }
                  />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
