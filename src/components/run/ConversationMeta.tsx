import type { ReactNode } from 'react'
import type { SamplingPick } from '../../types'
import { HoverTip } from './HoverTip'

interface ConversationMetaProps {
  chatlogId: number
  notebook: string | null
  turnCount: number
  samplingPick?: SamplingPick | null
  explorePickSummary?: string | null
  conversationStudentMessages?: number | null
  pendingStudentMessageNumber?: number | null
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

function firstWords(text: string, count: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= count) return text.trim()
  return `${words.slice(0, count).join(' ')}…`
}

function ExplorePickLine({ summary, preview }: { summary: string; preview: string }) {
  const label: ReactNode = (
    <>
      <span className="text-ochre">Explore</span>
      <span className="mx-1.5 opacity-50">·</span>
      <span className="font-sans normal-case tracking-normal text-[11px] text-faint font-normal">
        {preview}
      </span>
    </>
  )
  return (
    <HoverTip
      label={label}
      tip={summary}
      className="inline-flex items-baseline gap-0"
    />
  )
}

export function ConversationMeta({
  chatlogId,
  notebook,
  turnCount,
  samplingPick,
  explorePickSummary,
  conversationStudentMessages,
  pendingStudentMessageNumber,
}: ConversationMetaProps) {
  const showQueue =
    samplingPick != null &&
    conversationStudentMessages != null &&
    pendingStudentMessageNumber != null

  const exploreSummary =
    explorePickSummary != null && explorePickSummary.trim()
      ? explorePickSummary.trim()
      : null

  const summaryPreview = exploreSummary ? firstWords(exploreSummary, 10) : null

  const showExploreLine = summaryPreview != null && exploreSummary != null
  const showPickChip =
    showQueue &&
    samplingPick != null &&
    (!showExploreLine || samplingPick !== 'explore')

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
                  {samplingPick === 'explore' ? (
                    <span className="shrink-0 text-ochre">{pickLabel(samplingPick)}</span>
                  ) : (
                    <HoverTip
                      label={pickLabel(samplingPick)}
                      tip={pickTip(samplingPick)}
                      tone={pickTone(samplingPick)}
                    />
                  )}
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
              {showExploreLine && (
                <>
                  <Sep />
                  <ExplorePickLine summary={exploreSummary} preview={summaryPreview} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
